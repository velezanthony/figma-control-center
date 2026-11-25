// Sonda M0 (vía sin plugin): ejecutar código del API de plugins en la pestaña de Figma por Chrome DevTools Protocol.
// Uso: node spikes/m0/cdp-probe.ts   (antes: spikes/m0/chrome.sh; configuración en .env)
// Mide: ¿existe `figma`?, lectura del archivo, escritura reversible y si un script de varios MB llega entero.
import {
	CDP_HTTP_PATH,
	CDP_METHOD,
	CDP_TARGET_TYPE,
	FIGMA_GLOBAL_READY,
	READY_POLL_INTERVAL_MS,
} from "../../server/src/adapters/cdp/protocol.ts";
import { flatConfig } from "../../server/src/adapters/config/env.ts";

const config = flatConfig();

type Target = {
	readonly type: string;
	readonly url: string;
	readonly webSocketDebuggerUrl: string;
};
type CdpReply = {
	readonly id: number;
	readonly result?: {
		readonly result: { readonly value?: unknown };
		readonly exceptionDetails?: { readonly text: string };
	};
	readonly error?: { readonly message: string };
};

const BIG_SCRIPT_BYTES = 3_500_000; // tamaño de un lote grande de scripts

const base = `http://${config.cdp.host}:${config.cdp.port}`;
const targets = (await (
	await fetch(base + CDP_HTTP_PATH.targets)
).json()) as Target[];
const tab = targets.find(
	(t) =>
		t.type === CDP_TARGET_TYPE.page && t.url.startsWith(config.figma.fileUrl),
);
if (!tab)
	throw new Error(`No hay ninguna pestaña abierta en ${config.figma.fileUrl}`);

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, ko) => {
	ws.onopen = ok;
	ws.onerror = ko;
});
let nextId = 0;
const pending = new Map<number, (r: CdpReply) => void>();
ws.onmessage = (e) => {
	const r = JSON.parse(String(e.data)) as CdpReply;
	pending.get(r.id)?.(r);
	pending.delete(r.id);
};

// Ejecuta el cuerpo de una función asíncrona en la página y devuelve su valor (o el error de la página)
async function evaluate(
	body: string,
): Promise<{ ms: number; value?: unknown; error?: string }> {
	const id = ++nextId;
	const t0 = performance.now();
	const reply = await new Promise<CdpReply>((resolve) => {
		pending.set(id, resolve);
		ws.send(
			JSON.stringify({
				id,
				method: CDP_METHOD.evaluate,
				params: {
					expression: `(async () => { ${body} })()`,
					awaitPromise: true,
					returnByValue: true,
				},
			}),
		);
	});
	const ms = Math.round(performance.now() - t0);
	if (reply.error) return { ms, error: reply.error.message };
	if (reply.result?.exceptionDetails)
		return { ms, error: reply.result.exceptionDetails.text };
	return { ms, value: reply.result?.result.value };
}

// la página tarda en cargar el editor: esperar a que exista `figma`
const deadline = Date.now() + config.figma.readyTimeoutMs;
let ready = await evaluate("return typeof figma");
while (ready.value !== FIGMA_GLOBAL_READY && Date.now() < deadline) {
	await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
	ready = await evaluate("return typeof figma");
}
console.log("typeof figma:", ready.value);

console.log(
	"lectura:",
	await evaluate(
		"return { archivo: figma.root.name, paginas: figma.root.children.length, actual: figma.currentPage.name }",
	),
);

console.log(
	"escritura reversible:",
	await evaluate(
		"const f = figma.createFrame(); f.name = '__sonda_m0'; const id = f.id; const existe = !!(await figma.getNodeByIdAsync(id)); f.remove(); return { id, existe, borrado: !(await figma.getNodeByIdAsync(id)) };",
	),
);

console.log(
	`script de ${BIG_SCRIPT_BYTES} bytes:`,
	await evaluate(
		`const s = ${JSON.stringify("x".repeat(BIG_SCRIPT_BYTES))}; return s.length`,
	),
);

ws.close();
