// E57 captura pública: figma_capture de una pantalla sin sesión de example-mini deja
// su fichero en web-captures/ con ids y rutas estables (dos capturas seguidas, mismos ids), lo oculto fuera y las imágenes
// por hash; la respuesta no trae el árbol y pesa poco; no sale en «Capturas». Servidor MCP real, Chromium de Playwright.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type CaptureEnvironment,
	startCaptureEnvironment,
} from "../../harness/capture-environment.ts";

// Lo que puede pesar la respuesta de una pantalla: un resumen, nunca el árbol
const MAX_REPLY_BYTES = 4000;

type Node = {
	id: string;
	path: string;
	t: string;
	txt?: string;
	ref?: string;
	kids?: Node[];
};
type Capture = {
	contract: string;
	variants: { nodes: Node[] }[];
	images: Record<
		string,
		{ path: string; width: number; height: number; type: string }
	>;
};

const flat = (nodes: readonly Node[]): Node[] =>
	nodes.flatMap((n) => [n, ...flat(n.kids ?? [])]);

let c: CaptureEnvironment;
before(async () => {
	c = await startCaptureEnvironment();
});
after(async () => {
	await c?.stop();
});

const captureHome = async () => {
	const r = await c.claude.callTool(TOOL_NAME.capture, { screens: ["inicio"] });
	assert.equal(r.isError, false, r.text);
	const files = r.out["files"] as { screen: string; path: string }[];
	const path = files[0]?.path ?? "";
	return {
		r,
		path,
		capture: JSON.parse(readFileSync(path, "utf8")) as Capture,
	};
};

describe("E57 · captura pública", () => {
	it("deja la captura en web-captures/<día>/inicio_<HHMMSS>.json y responde solo el resumen", async () => {
		const { r, path, capture } = await captureHome();
		assert.match(
			relative(c.outputDir, path).split("\\").join("/"),
			/^web-captures\/\d{4}-\d{2}-\d{2}\/inicio_\d{6}(-\d+)?\.json$/,
		);
		assert.equal(capture.contract, "capture@1");
		assert.equal(r.out["ok"], true);
		assert.deepEqual(r.out["touchedNodeIds"], []);
		assert.match(
			String((r.out["summary"] as string[])[0]),
			/^inicio: 1 variante, \d+ nodos, 1 imagen/,
		);
		assert.ok(
			Buffer.byteLength(r.text) < MAX_REPLY_BYTES,
			`${Buffer.byteLength(r.text)} bytes`,
		);
		assert.doesNotMatch(r.text, /"kids"|"txt"|Listo/);
	});

	it("dos capturas seguidas dan los mismos ids y rutas", async () => {
		const a = flat((await captureHome()).capture.variants[0]?.nodes ?? []);
		const b = flat((await captureHome()).capture.variants[0]?.nodes ?? []);
		assert.deepEqual(
			a.map((n) => [n.id, n.path]),
			b.map((n) => [n.id, n.path]),
		);
		assert.ok(a.some((n) => n.path === "main[0]/h1[0]"));
	});

	it("lo oculto no se captura y las imágenes van por su hash a img/", async () => {
		const { capture } = await captureHome();
		const nodes = flat(capture.variants[0]?.nodes ?? []);
		assert.equal(
			nodes.some((n) => n.txt === "Oculto"),
			false,
		);
		const img = nodes.find((n) => n.t === "img");
		assert.ok(img?.ref);
		const entry = capture.images[img.ref];
		assert.deepEqual(
			[entry?.width, entry?.height, entry?.type],
			[40, 20, "png"],
		);
		assert.ok(existsSync(join(c.outputDir, "web-captures", entry?.path ?? "")));
	});

	it("no aparece en «Capturas» y la llamada queda en el histórico con su ruta", async () => {
		const { path } = await captureHome();
		assert.deepEqual(c.env.rows("SELECT 1 FROM captures"), []);
		const rows = c.env.rows<{ result_path: string | null }>(
			"SELECT result_path FROM calls WHERE tool = 'figma_capture' ORDER BY rowid DESC LIMIT 1",
		);
		assert.equal(rows[0]?.result_path, path);
	});
});
