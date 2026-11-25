// Una conexión CDP al navegador del Chrome de captura con sesiones planas por pestaña. No reutiliza CdpClient
// (adapters/cdp): aquel habla con UNA pestaña de Figma por Runtime.evaluate y elige la pestaña por la clave del archivo;
// esto necesita el websocket del navegador, sesiones y eventos. Los adaptadores no se importan entre sí.
import { z } from "zod";

const MessageSchema = z.object({
	id: z.number().optional(),
	sessionId: z.string().optional(),
	method: z.string().optional(),
	params: z.record(z.string(), z.unknown()).optional(),
	result: z.record(z.string(), z.unknown()).optional(),
	error: z.object({ message: z.string() }).optional(),
});

export type CdpEvent = {
	readonly sessionId: string | undefined;
	readonly method: string;
	readonly params: Readonly<Record<string, unknown>>;
};

export type OutgoingMessage = {
	readonly method: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly sessionId?: string | undefined;
};

type Pending = {
	readonly resolve: (value: Record<string, unknown>) => void;
	readonly reject: (e: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
};

export class CdpConnection {
	readonly #socket: WebSocket;
	readonly #timeoutMs: number;
	readonly #trace: ((m: OutgoingMessage) => void) | undefined;
	readonly #pending = new Map<number, Pending>();
	#listeners: ((e: CdpEvent) => void)[] = [];
	#next = 0;

	private constructor(
		socket: WebSocket,
		timeoutMs: number,
		trace?: (m: OutgoingMessage) => void,
	) {
		this.#socket = socket;
		this.#timeoutMs = timeoutMs;
		this.#trace = trace;
		socket.onmessage = (e) => this.#onMessage(String(e.data));
		socket.onclose = () => {
			for (const [id, p] of this.#pending) {
				clearTimeout(p.timer);
				this.#pending.delete(id);
				p.reject(new Error("el Chrome de captura cerró la conexión"));
			}
		};
	}

	// `trace` ve cada mensaje que sale (lo usan los tests para comprobar qué texto se manda)
	static async open(
		webSocketUrl: string,
		timeoutMs: number,
		trace?: (m: OutgoingMessage) => void,
	): Promise<CdpConnection> {
		const socket = new WebSocket(webSocketUrl);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () =>
				reject(new Error(`no se pudo conectar a ${webSocketUrl}`));
		});
		return new CdpConnection(socket, timeoutMs, trace);
	}

	send(
		method: string,
		params: Readonly<Record<string, unknown>> = {},
		sessionId?: string,
	): Promise<Record<string, unknown>> {
		const id = ++this.#next;
		this.#trace?.({ method, params, sessionId });
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`${method} no respondió en ${this.#timeoutMs} ms`));
			}, this.#timeoutMs);
			this.#pending.set(id, { resolve, reject, timer });
			this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	on(listener: (e: CdpEvent) => void): () => void {
		this.#listeners.push(listener);
		return () => {
			this.#listeners = this.#listeners.filter((l) => l !== listener);
		};
	}

	// El primer evento que cumple `match`, o null si vence el plazo
	waitFor(
		match: (e: CdpEvent) => boolean,
		timeoutMs: number,
	): Promise<CdpEvent | null> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				off();
				resolve(null);
			}, timeoutMs);
			const off = this.on((e) => {
				if (!match(e)) return;
				clearTimeout(timer);
				off();
				resolve(e);
			});
		});
	}

	close(): void {
		this.#socket.close();
	}

	#onMessage(raw: string): void {
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return;
		}
		const m = MessageSchema.safeParse(json);
		if (!m.success) return;
		const { id, method } = m.data;
		if (id !== undefined) {
			const p = this.#pending.get(id);
			if (!p) return;
			clearTimeout(p.timer);
			this.#pending.delete(id);
			if (m.data.error) p.reject(new Error(m.data.error.message));
			else p.resolve(m.data.result ?? {});
			return;
		}
		if (method === undefined) return;
		const event: CdpEvent = {
			sessionId: m.data.sessionId,
			method,
			params: m.data.params ?? {},
		};
		for (const l of [...this.#listeners]) l(event);
	}
}
