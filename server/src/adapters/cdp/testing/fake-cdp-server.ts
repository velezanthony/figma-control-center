// Servidor CDP falso para tests: HTTP /json/list + WebSocket. Dos modos que se combinan:
//  - evalúa las expresiones con `vm` contra un objeto `figma` de mentira (tests de integración del adaptador);
//  - `respond` decide la respuesta de cada expresión (simulador de Figma de los E2E herméticos, server/test/harness).
// Todo lo que emite se valida contra el contrato de la frontera (server/test/contracts/cdp.ts): si un doble
// emitiera algo que el contrato no permite, queda en `violations` y `close()` falla.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createContext, runInContext } from "node:vm";
import { type RawData, WebSocketServer } from "ws";
import {
	type EvaluateResponse,
	EvaluateResponseSchema,
	exceptionReply,
	type Frame,
	protocolErrorReply,
	TargetInfoSchema,
	TargetListSchema,
	valueReply,
} from "../../../../test/contracts/cdp.ts";

// Lo que el simulador decide responder a una expresión
export type FakeReply =
	| { readonly kind: "value"; readonly value: unknown }
	| {
			readonly kind: "exception";
			readonly className: string;
			readonly message: string;
			readonly frames: readonly Frame[];
			readonly lineNumber?: number;
	  }
	| {
			readonly kind: "protocolError";
			readonly code: number;
			readonly message: string;
	  }
	// No responde nunca (el cliente agota su plazo)
	| { readonly kind: "hang" }
	// Espera a `release(gate)` y entonces responde con `afterRelease`: control determinista del tiempo
	| {
			readonly kind: "gated";
			readonly gate: string;
			readonly afterRelease: FakeReply;
	  };

export type FakeCdpOptions = {
	readonly figma?: object | undefined;
	// Otros globales de la página (p. ej. INITIAL_OPTIONS o location) para el modo `vm`
	readonly globals?: Readonly<Record<string, unknown>> | undefined;
	readonly tabUrl?: string | undefined;
	// Varias pestañas Figma sobre el mismo Chrome (una por URL): para probar CDP por tenant (CA-5). `[]`: sin ninguna
	readonly tabUrls?: readonly string[] | undefined;
	// Dónde acaba una pestaña abierta con PUT /json/new (por defecto, en la URL pedida): simula que Figma la lleva a otro archivo
	readonly openedTabLandsOn?: ((requested: string) => string) | undefined;
	readonly hang?: boolean | undefined;
	// Decide la respuesta; `undefined` = evaluar con `vm`
	readonly respond?:
		| ((expression: string) => FakeReply | undefined)
		| undefined;
};

export type FakeCdp = {
	readonly port: number;
	readonly tabUrl: string;
	readonly expressions: string[];
	// Las pestañas que hay ahora (url por pestaña) y lo que el cliente le pidió a Chrome (método y ruta de /json/new y /json/close)
	tabs(): readonly string[];
	readonly tabRequests: string[];
	// Respuestas que el contrato no permite (vacío si el doble se portó bien)
	readonly violations: string[];
	// Libera las respuestas esperando en `gate`
	release(gate: string): void;
	// Cuántas respuestas esperan ahora mismo en `gate`: un `release` anterior a su llegada se pierde, así que
	// el test espera a que haya una antes de liberar (nada de dormir un rato)
	waiting(gate: string): number;
	close(): Promise<void>;
};

const VM_FILE = "evalmachine.<anonymous>";
const VM_FILE_FIRST_LINE = /^evalmachine\.<anonymous>:(\d+)/;

type Failure = { name: string; message: string; stack?: string };

function exceptionDetails(error: Failure) {
	const frames = (error.stack ?? "")
		.split("\n")
		.filter((l) => l.startsWith("    at "))
		.map((l) => l.replaceAll(VM_FILE, "<anonymous>"));
	const syntaxLine = VM_FILE_FIRST_LINE.exec(error.stack ?? "")?.[1];
	return {
		exceptionId: 1,
		text: "Uncaught",
		lineNumber: syntaxLine === undefined ? 0 : Number(syntaxLine) - 1,
		columnNumber: 0,
		exception: {
			type: "object",
			subtype: "error",
			className: error.name,
			description: [`${error.name}: ${error.message}`, ...frames].join("\n"),
		},
	};
}

const DEFAULT_TAB_URL = "https://www.figma.com/design/KEY/Nombre";

export async function startFakeCdp(
	options: FakeCdpOptions = {},
): Promise<FakeCdp> {
	const expressions: string[] = [];
	const violations: string[] = [];
	const gates = new Map<string, Array<() => void>>();
	const context = createContext({
		...options.globals,
		...(options.figma === undefined ? {} : { figma: options.figma }),
	});
	const tabUrl = options.tabUrl ?? DEFAULT_TAB_URL;
	// Las pestañas Figma viven aquí para que /json/new y /json/close las cambien; id estable por pestaña
	let nextTabId = 1;
	const tabList: { id: string; url: string }[] = (
		options.tabUrls ?? [options.tabUrl ?? `${DEFAULT_TAB_URL}?node-id=1`]
	).map((url) => ({ id: String(nextTabId++), url }));
	const tabRequests: string[] = [];
	const http: Server = createServer((req, res) => {
		const { port } = http.address() as AddressInfo;
		const targetOf = (t: { id: string; url: string }) => ({
			id: t.id,
			title: "Figma",
			type: "page",
			url: t.url,
			webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${t.id}`,
		});
		const json = (body: unknown) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(body));
		};
		if (req.url === "/json/list") {
			const targets = [
				{
					id: "0",
					title: "Omnibox Popup",
					type: "browser_ui",
					url: "chrome://omnibox-popup",
					webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/0`,
				},
				...tabList.map(targetOf),
			];
			const valid = TargetListSchema.safeParse(targets);
			if (!valid.success) violations.push(`/json/list: ${valid.error.message}`);
			json(targets);
			return;
		}
		// Chrome reciente solo acepta PUT en /json/new (un GET es 405)
		if (req.url?.startsWith("/json/new")) {
			tabRequests.push(`${req.method} ${req.url}`);
			if (req.method !== "PUT") {
				res.statusCode = 405;
				res.end(
					"Using unsafe HTTP verb GET to invoke /json/new. This action supports only PUT verb.",
				);
				return;
			}
			const requested = decodeURIComponent(req.url.slice("/json/new?".length));
			const tab = {
				id: String(nextTabId++),
				url: options.openedTabLandsOn?.(requested) ?? requested,
			};
			tabList.push(tab);
			const target = targetOf(tab);
			const valid = TargetInfoSchema.safeParse(target);
			if (!valid.success) violations.push(`/json/new: ${valid.error.message}`);
			json(target);
			return;
		}
		if (req.url?.startsWith("/json/close/")) {
			tabRequests.push(`${req.method} ${req.url}`);
			const id = req.url.slice("/json/close/".length);
			const at = tabList.findIndex((t) => t.id === id);
			if (at === -1) {
				res.statusCode = 404;
				res.end(`No such target id: ${id}`);
				return;
			}
			tabList.splice(at, 1);
			res.end("Target is closing");
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	const wss = new WebSocketServer({
		server: http,
		maxPayload: 64 * 1024 * 1024,
	});

	const replyFor = async (
		id: number,
		expression: string,
	): Promise<EvaluateResponse | null> => {
		let decided = options.respond?.(expression);
		while (decided?.kind === "gated") {
			const { gate } = decided;
			await new Promise<void>((resolve) => {
				gates.set(gate, [...(gates.get(gate) ?? []), resolve]);
			});
			decided = decided.afterRelease;
		}
		if (decided?.kind === "hang") return null;
		if (decided?.kind === "value") return valueReply(id, decided.value);
		if (decided?.kind === "exception") return exceptionReply(id, decided);
		if (decided?.kind === "protocolError") {
			return protocolErrorReply(id, decided.code, decided.message);
		}
		try {
			const value: unknown = await runInContext(expression, context);
			return valueReply(id, value);
		} catch (e) {
			return EvaluateResponseSchema.parse({
				id,
				result: {
					result: { type: "object", subtype: "error" },
					exceptionDetails: exceptionDetails(e as Failure),
				},
			});
		}
	};

	wss.on("connection", (socket) => {
		const answer = async (raw: RawData): Promise<void> => {
			const { id, params } = JSON.parse(String(raw)) as {
				id: number;
				params: { expression: string };
			};
			expressions.push(params.expression);
			if (options.hang) return;
			const reply = await replyFor(id, params.expression);
			if (reply === null) return;
			const valid = EvaluateResponseSchema.safeParse(reply);
			if (!valid.success) {
				violations.push(`Runtime.evaluate: ${valid.error.message}`);
				socket.terminate();
				return;
			}
			socket.send(JSON.stringify(reply));
		};
		socket.on("message", (raw) => {
			answer(raw).catch((e: unknown) => {
				violations.push(`el doble falló: ${String(e)}`);
				socket.terminate();
			});
		});
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
	const port = (http.address() as AddressInfo).port;
	return {
		port,
		tabUrl,
		expressions,
		tabs: () => tabList.map((t) => t.url),
		tabRequests,
		violations,
		waiting: (gate) => gates.get(gate)?.length ?? 0,
		release: (gate) => {
			for (const resolve of gates.get(gate) ?? []) resolve();
			gates.delete(gate);
		},
		close: async () => {
			for (const client of wss.clients) client.terminate();
			wss.close();
			http.closeAllConnections();
			await new Promise<void>((resolve) => http.close(() => resolve()));
			if (violations.length > 0) {
				throw new Error(
					`El doble CDP emitió algo que el contrato no permite:\n${violations.join("\n")}`,
				);
			}
		},
	};
}
