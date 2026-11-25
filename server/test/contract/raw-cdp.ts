// Sesión CDP mínima y SIN interpretar para las pruebas que hablan con Figma real (e2e-record y e2e-contract):
// devuelve el mensaje de Chrome tal cual, para compararlo con el contrato. Solo se conecta a la pestaña cuyo
// fileKey es el del archivo de pruebas (nunca navega ni abre pestañas).
import { z } from "zod";
import { EvaluateResponseSchema, TargetListSchema } from "../contracts/cdp.ts";
import { figmaFileKey } from "../support/test-file-guard.ts";

const TARGETS_PATH = "/json/list";
const PAGE_TYPE = "page";
const EVALUATE = "Runtime.evaluate";
const OPEN_TIMEOUT_MS = 5000;

// Sin sesión, Figma redirige la pestaña a /login?redirect_uri=<ruta del archivo>: sigue siendo la del archivo de pruebas
const LOGIN_PATH = "/login";
const REDIRECT_PARAM = "redirect_uri";

function tabFileKey(url: string): string | null {
	const direct = figmaFileKey(url);
	if (direct !== null) return direct;
	try {
		const parsed = new URL(url);
		if (parsed.pathname !== LOGIN_PATH) return null;
		const back = parsed.searchParams.get(REDIRECT_PARAM);
		return back === null
			? null
			: figmaFileKey(`https://${parsed.hostname}${back}`);
	} catch {
		return null;
	}
}

export class TestingTabNotOpen extends Error {
	readonly testFileUrl: string;
	constructor(testFileUrl: string) {
		super(
			`La pestaña del archivo de pruebas no está abierta en el Chrome de depuración: ábrela a mano (${testFileUrl}) y vuelve a lanzar.`,
		);
		this.testFileUrl = testFileUrl;
	}
}

export type RawSession = {
	readonly tabUrl: string;
	// El mensaje de Chrome sin tocar
	evaluate(expression: string, timeoutMs: number): Promise<unknown>;
	close(): void;
};

export async function openTestingTab(options: {
	readonly host: string;
	readonly port: number;
	readonly testFileUrl: string;
}): Promise<RawSession> {
	const res = await fetch(
		`http://${options.host}:${options.port}${TARGETS_PATH}`,
		{
			signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
		},
	);
	const targets = TargetListSchema.parse(await res.json());
	// El fileKey, no el prefijo de la URL: el nombre del archivo y los parámetros cambian
	const tab = targets.find(
		(t) =>
			t.type === PAGE_TYPE &&
			tabFileKey(t.url) === figmaFileKey(options.testFileUrl) &&
			t.webSocketDebuggerUrl !== undefined,
	);
	if (tab?.webSocketDebuggerUrl === undefined) {
		throw new TestingTabNotOpen(options.testFileUrl);
	}
	const socket = new WebSocket(tab.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener(
			"error",
			() => reject(new Error("no se pudo abrir el WebSocket")),
			{ once: true },
		);
	});
	let nextId = 0;
	const waiting = new Map<number, (message: unknown) => void>();
	socket.addEventListener("message", (e) => {
		const message: unknown = JSON.parse(String(e.data));
		const id = z.object({ id: z.number() }).safeParse(message);
		if (id.success) waiting.get(id.data.id)?.(message);
	});
	return {
		tabUrl: tab.url,
		evaluate: (expression, timeoutMs) =>
			new Promise((resolve, reject) => {
				const id = ++nextId;
				const timer = setTimeout(() => {
					waiting.delete(id);
					reject(new Error(`Sin respuesta en ${timeoutMs} ms`));
				}, timeoutMs);
				waiting.set(id, (message) => {
					clearTimeout(timer);
					waiting.delete(id);
					resolve(message);
				});
				socket.send(
					JSON.stringify({
						id,
						method: EVALUATE,
						params: { expression, awaitPromise: true, returnByValue: true },
					}),
				);
			}),
		close: () => socket.close(),
	};
}

export const isEvaluateResponse = (message: unknown) =>
	EvaluateResponseSchema.safeParse(message);
