import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import {
	callTimeout,
	chromeUnreachable,
	FIGMA_NOT_READY_REASON,
	type FigmaError,
	figmaNotReady,
	figmaTabNotFound,
} from "#domain/figma-error.ts";
import { figmaFileKey } from "#domain/figma-url.ts";
import { err, ok, type Result } from "#domain/result.ts";
import {
	CDP_EVALUATE_OPTIONS,
	CDP_HTTP_PATH,
	CDP_METHOD,
	CDP_TARGET_TYPE,
	FIGMA_ACCESS,
	FIGMA_ACCESS_EXPRESSION,
	READY_POLL_INTERVAL_MS,
} from "./protocol.ts";
import { toScriptError } from "./script-error.ts";

export type CdpClientOptions = {
	readonly host: string;
	readonly port: number;
	readonly fileUrl: string;
	readonly callTimeoutMs: number;
	readonly readyTimeoutMs: number;
	readonly readyPollIntervalMs?: number;
	// D-2 B: sin la pestaña del proyecto, el servidor la abre. `withLock` serializa la apertura por clave de archivo
	// entre sesiones (un fichero exclusivo en FCC_LOCK_DIR) para que dos no abran dos pestañas
	readonly openTab?: {
		readonly withLock: <T>(
			fileKey: string,
			run: () => Promise<T>,
		) => Promise<T>;
	};
};

export type EvaluateOptions = {
	readonly lineOffset?: number;
	readonly timeoutMs?: number | undefined;
	// false: no espera a que exista `figma` (lo usa figma_status)
	readonly waitReady?: boolean;
};

const NewTargetSchema = z.object({
	id: z.string(),
	url: z.string(),
	webSocketDebuggerUrl: z.string(),
});

const TargetListSchema = z.array(
	z.object({
		id: z.string(),
		type: z.string(),
		url: z.string(),
		webSocketDebuggerUrl: z.string().optional(),
	}),
);

const ReplySchema = z.object({
	id: z.number(),
	result: z
		.object({
			result: z.object({ value: z.unknown().optional() }),
			exceptionDetails: z
				.object({
					text: z.string(),
					lineNumber: z.number().optional(),
					exception: z
						.object({
							className: z.string().optional(),
							description: z.string().optional(),
						})
						.optional(),
				})
				.optional(),
		})
		.optional(),
	error: z.object({ message: z.string() }).optional(),
});
type Reply = z.infer<typeof ReplySchema>;

type Pending = {
	readonly resolve: (reply: Result<Reply, FigmaError>) => void;
	readonly timer: ReturnType<typeof setTimeout>;
};

export class CdpClient {
	readonly #options: CdpClientOptions;

	get fileUrl(): string {
		return this.#options.fileUrl;
	}

	readonly #pending = new Map<number, Pending>();
	// id de una petición vencida → se resuelve al llegar su respuesta o al cerrarse el socket
	readonly #orphanDone = new Map<number, () => void>();
	readonly #orphans = new Map<number, Promise<void>>();
	#socket: WebSocket | null = null;
	#nextId = 0;
	#figmaReady = false;
	// Id de la pestaña que este cliente acaba de abrir y aún no ha comprobado
	#justOpened: string | null = null;
	#openedNotice: string | null = null;

	constructor(options: CdpClientOptions) {
		this.#options = options;
	}

	get #endpoint(): string {
		return `${this.#options.host}:${this.#options.port}`;
	}

	// Una pestaña de este archivo (la misma clave es la misma pestaña, con o sin nombre, /design/ o /file/, con o sin
	// ?node-id)
	#matching(
		targets: z.infer<typeof TargetListSchema>,
	): { readonly id: string; readonly webSocketDebuggerUrl: string } | null {
		const wanted = figmaFileKey(this.#options.fileUrl);
		for (const t of targets) {
			if (
				wanted !== null &&
				t.type === CDP_TARGET_TYPE.page &&
				figmaFileKey(t.url) === wanted &&
				t.webSocketDebuggerUrl !== undefined
			) {
				return { id: t.id, webSocketDebuggerUrl: t.webSocketDebuggerUrl };
			}
		}
		return null;
	}

	async #targets(): Promise<
		Result<z.infer<typeof TargetListSchema>, FigmaError>
	> {
		let body: unknown;
		try {
			const res = await fetch(
				`http://${this.#endpoint}${CDP_HTTP_PATH.targets}`,
				{ signal: AbortSignal.timeout(this.#options.callTimeoutMs) },
			);
			body = await res.json();
		} catch {
			return err(chromeUnreachable(this.#endpoint));
		}
		const targets = TargetListSchema.safeParse(body);
		return targets.success
			? ok(targets.data)
			: err(chromeUnreachable(this.#endpoint));
	}

	async discoverTab(): Promise<
		Result<{ readonly webSocketDebuggerUrl: string }, FigmaError>
	> {
		const targets = await this.#targets();
		if (!targets.ok) return targets;
		const found = this.#matching(targets.value);
		if (found !== null) return ok(found);
		const key = figmaFileKey(this.#options.fileUrl);
		if (this.#options.openTab === undefined || key === null) {
			return err(figmaTabNotFound(this.#options.fileUrl));
		}
		return this.#openTab(this.#options.openTab, key);
	}

	// La pestaña del proyecto no está: se pide a Chrome una nueva (PUT /json/new?<url>; las versiones recientes rechazan
	// GET). Bajo el lock por archivo y tras volver a listar: otra sesión pudo abrirla mientras esperábamos. Nunca se
	// abre más de una por archivo.
	async #openTab(
		open: NonNullable<CdpClientOptions["openTab"]>,
		key: string,
	): Promise<Result<{ readonly webSocketDebuggerUrl: string }, FigmaError>> {
		const opened = open.withLock(key, async () => {
			const again = await this.#targets();
			if (!again.ok) return again;
			const existing = this.#matching(again.value);
			if (existing !== null) return ok(existing);
			let created: z.infer<typeof NewTargetSchema>;
			try {
				const res = await fetch(
					`http://${this.#endpoint}${CDP_HTTP_PATH.newTarget}?${encodeURIComponent(this.#options.fileUrl)}`,
					{
						method: "PUT",
						signal: AbortSignal.timeout(this.#options.callTimeoutMs),
					},
				);
				if (!res.ok) return err(chromeUnreachable(this.#endpoint));
				created = NewTargetSchema.parse(await res.json());
			} catch {
				return err(chromeUnreachable(this.#endpoint));
			}
			this.#justOpened = created.id;
			return ok(created);
		});
		// Si otra sesión tiene la apertura y no termina a tiempo, se falla con motivo (no se abre sin el lock)
		return opened.catch((e: unknown) =>
			err(
				figmaTabNotFound(
					this.#options.fileUrl,
					e instanceof Error ? e.message : String(e),
				),
			),
		);
	}

	// Cierra una pestaña que abrimos nosotros (nunca otra)
	async #closeTab(id: string): Promise<void> {
		await fetch(`http://${this.#endpoint}${CDP_HTTP_PATH.closeTarget}${id}`, {
			signal: AbortSignal.timeout(this.#options.callTimeoutMs),
		}).catch(() => {});
	}

	// Lo que el servidor hizo por su cuenta y quien responde debe decir (una sola vez): abrir la pestaña
	takeOpenedNotice(): string | null {
		const notice = this.#openedNotice;
		this.#openedNotice = null;
		return notice;
	}

	async evaluate(
		expression: string,
		options: EvaluateOptions = {},
	): Promise<Result<unknown, FigmaError>> {
		const timeoutMs = options.timeoutMs ?? this.#options.callTimeoutMs;
		const connected = await this.#connect();
		if (!connected.ok) return connected;
		if (options.waitReady ?? true) {
			const ready = await this.#waitForFigma();
			if (!ready.ok) return ready;
		}
		const reply = await this.#send(expression, timeoutMs, true);
		if (!reply.ok) return reply;
		const { result, error } = reply.value;
		if (error) return err(toScriptError({ text: error.message }, 0));
		if (result?.exceptionDetails) {
			return err(
				toScriptError(result.exceptionDetails, options.lineOffset ?? 0),
			);
		}
		return ok(result?.result.value ?? null);
	}

	// Espera a que la pestaña esté lista para recibir scripts (Chrome, pestaña, sesión y `figma`), sin enviar ninguno
	async ready(): Promise<Result<true, FigmaError>> {
		const connected = await this.#connect();
		if (!connected.ok) return connected;
		return this.#waitForFigma();
	}

	// Los scripts que vencieron su plazo y de los que aún no ha llegado respuesta: siguen en la pestaña
	orphanedScript(): Promise<void> | undefined {
		if (this.#orphans.size === 0) return undefined;
		return Promise.all([...this.#orphans.values()]).then(() => undefined);
	}

	close(): void {
		this.#socket?.close();
		this.#socket = null;
	}

	async #connect(): Promise<Result<WebSocket, FigmaError>> {
		if (this.#socket?.readyState === WebSocket.OPEN) return ok(this.#socket);
		this.#figmaReady = false;
		const tab = await this.discoverTab();
		if (!tab.ok) return tab;
		const socket = new WebSocket(tab.value.webSocketDebuggerUrl);
		const opened = await new Promise<boolean>((resolve) => {
			socket.addEventListener("open", () => resolve(true), { once: true });
			socket.addEventListener("error", () => resolve(false), { once: true });
		});
		if (!opened) {
			this.#justOpened = null;
			return err(chromeUnreachable(this.#endpoint));
		}
		socket.addEventListener("message", (e) => this.#onMessage(String(e.data)));
		socket.addEventListener("close", () => this.#onClose(socket));
		this.#socket = socket;
		if (this.#justOpened !== null) {
			const checked = await this.#checkOpenedTab(this.#justOpened, socket);
			this.#justOpened = null;
			if (!checked.ok) return checked;
		}
		return ok(socket);
	}

	// La pestaña recién abierta: se espera a que cargue (la misma espera de siempre) y se comprueba que Figma la dejó en
	// el archivo del proyecto. Si acabó en otro (un redireccionamiento, otra cuenta), se cierra y se falla: nunca se
	// trabaja sobre un archivo que nadie eligió.
	async #checkOpenedTab(
		id: string,
		socket: WebSocket,
	): Promise<Result<WebSocket, FigmaError>> {
		await this.#waitForFigma();
		const targets = await this.#targets();
		const tab = targets.ok ? targets.value.find((t) => t.id === id) : undefined;
		const wanted = figmaFileKey(this.#options.fileUrl);
		if (tab !== undefined && figmaFileKey(tab.url) !== wanted) {
			socket.close();
			if (this.#socket === socket) this.#socket = null;
			this.#figmaReady = false;
			await this.#closeTab(id);
			return err(
				figmaTabNotFound(
					this.#options.fileUrl,
					`Se abrió la pestaña pero Figma la llevó a otro archivo (${tab.url}): se cerró.`,
				),
			);
		}
		this.#openedNotice = `El servidor abrió la pestaña del archivo ${this.#options.fileUrl} en Chrome porque no estaba abierta.`;
		return ok(socket);
	}

	#onMessage(raw: string): void {
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return;
		}
		const reply = ReplySchema.safeParse(json);
		if (!reply.success) return;
		this.#settleOrphan(reply.data.id);
		const pending = this.#pending.get(reply.data.id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.#pending.delete(reply.data.id);
		pending.resolve(ok(reply.data));
	}

	#onClose(socket: WebSocket): void {
		if (this.#socket === socket) this.#socket = null;
		this.#figmaReady = false;
		for (const id of [...this.#orphanDone.keys()]) this.#settleOrphan(id);
		for (const [id, pending] of this.#pending) {
			clearTimeout(pending.timer);
			this.#pending.delete(id);
			pending.resolve(err(chromeUnreachable(this.#endpoint)));
		}
	}

	#settleOrphan(id: number): void {
		this.#orphanDone.get(id)?.();
		this.#orphanDone.delete(id);
		this.#orphans.delete(id);
	}

	#send(
		expression: string,
		timeoutMs: number,
		keepOnTimeout = false,
	): Promise<Result<Reply, FigmaError>> {
		const socket = this.#socket;
		if (socket?.readyState !== WebSocket.OPEN) {
			return Promise.resolve(err(chromeUnreachable(this.#endpoint)));
		}
		const id = ++this.#nextId;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				if (keepOnTimeout) {
					this.#orphans.set(
						id,
						new Promise<void>((done) => this.#orphanDone.set(id, done)),
					);
				}
				resolve(err(callTimeout(timeoutMs)));
			}, timeoutMs);
			this.#pending.set(id, { resolve, timer });
			socket.send(
				JSON.stringify({
					id,
					method: CDP_METHOD.evaluate,
					params: { expression, ...CDP_EVALUATE_OPTIONS },
				}),
			);
		});
	}

	// Pregunta en cada vuelta lo mismo que figma_status: lista → sigue; sin sesión o solo lectura → falla en el acto
	// con ese motivo (esperar no lo arregla); cargando → sigue esperando hasta el plazo.
	async #waitForFigma(): Promise<Result<true, FigmaError>> {
		if (this.#figmaReady) return ok(true);
		const interval =
			this.#options.readyPollIntervalMs ?? READY_POLL_INTERVAL_MS;
		const deadline = Date.now() + this.#options.readyTimeoutMs;
		for (;;) {
			const probe = await this.#send(
				FIGMA_ACCESS_EXPRESSION,
				this.#options.callTimeoutMs,
			);
			if (!probe.ok) return probe;
			switch (probe.value.result?.result.value) {
				case FIGMA_ACCESS.ready:
					this.#figmaReady = true;
					return ok(true);
				case FIGMA_ACCESS.notLoggedIn:
					return err(
						figmaNotReady(
							0,
							FIGMA_NOT_READY_REASON.notLoggedIn,
							this.#options.fileUrl,
						),
					);
				case FIGMA_ACCESS.viewOnly:
					return err(
						figmaNotReady(
							0,
							FIGMA_NOT_READY_REASON.viewOnly,
							this.#options.fileUrl,
						),
					);
				default:
					break;
			}
			// Se duerme como mucho lo que queda y se pregunta una última vez al vencer el plazo
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return err(
					figmaNotReady(
						this.#options.readyTimeoutMs,
						FIGMA_NOT_READY_REASON.loading,
						this.#options.fileUrl,
					),
				);
			}
			await sleep(Math.min(interval, remaining));
		}
	}
}
