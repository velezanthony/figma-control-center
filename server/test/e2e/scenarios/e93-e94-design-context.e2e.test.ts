// E93 y E94: figma_design_context, diseño a código. Servidor MCP real con el
// proyecto `example-mini` (su sheets@1 con `source`, su map@1) y el simulador de Figma, que contesta con el contexto que
// leería el script de la pestaña. Sin Figma, sin el proyecto consumidor y sin el 9222. El script de verdad se prueba contra el doble
// del API de plugins (server/test/kits/figma/pure/design-context-script.test.ts) y contra Figma real (make kit-contract).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { DesignContextSchema } from "#adapters/contracts/design-context.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type Environment,
	FILE_URL,
	startEnvironment,
} from "../../harness/environment.ts";
import { exampleMiniProject } from "../../harness/example-mini.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";

let work: string;
let env: Environment;
let claude: FakeClaudeCode;
before(async () => {
	work = await mkdtemp(join(tmpdir(), "example-mini-"));
	// La web de example-mini no se usa: figma_design_context no captura
	const project = await exampleMiniProject(
		join(work, "proyecto"),
		"http://127.0.0.1:1",
		FILE_URL,
	);
	env = await startEnvironment({ dashboard: false, projects: [project] });
	claude = await env.startClaude({ reply: null });
});
after(async () => {
	await env?.stop();
	await rm(work, { recursive: true, force: true });
});

type Json = Record<string, any>;
const contextOf = (out: Json) =>
	DesignContextSchema.parse(
		JSON.parse(readFileSync(String(out["path"]), "utf8")),
	);

const read = (args: Record<string, unknown>) =>
	claude.callTool(TOOL_NAME.designContext, args);

describe("E93 · contexto de una pantalla", () => {
	it("deja design-context@1 en reads/ con el árbol, el origen, las variables, las clases y la plantilla de cada hoja", async () => {
		const r = await read({ nodeId: "10:1" });
		assert.equal(r.isError, false, r.text);
		assert.equal(r.out["ok"], true);
		assert.deepEqual(r.out["touchedNodeIds"], []);
		const context = contextOf(r.out);
		assert.deepEqual(context.file, {
			key: "SIMULADO",
			name: "Archivo de ejemplo",
		});
		assert.deepEqual(context.origin, { kind: "area", key: "inicio/portada" });
		assert.deepEqual(
			context.nodes.map((n) => [n.id, n.parent]),
			[
				["10:1", null],
				["10:6", "10:1"],
				["10:7", "10:1"],
				["10:8", "10:1"],
				["10:9", "10:1"],
			],
		);
		assert.deepEqual(context.components["k-marca"]?.code, {
			source: "plantillas/marca.html",
			tag: '<span class="marca">',
			by: "key",
		});
		assert.equal(context.components["k-marca"]?.sheet, "marca");
		assert.deepEqual(context.nodes[0]?.fills, [{ variable: "VariableID:1:9" }]);
		assert.equal(context.variables["VariableID:1:9"]?.codeClass, "fondo");
		assert.deepEqual(context.nodes[0]?.hints, {
			classes: ["bg-fondo"],
			unmapped: [],
		});
	});

	it("saca la captura del nodo (en screenshots/) y el resumen es corto: conteos, sin la lista", async () => {
		const r = await read({ nodeId: "10:1" });
		const shot = String(r.out["screenshotPath"]);
		assert.match(shot, /screenshots/);
		assert.ok(existsSync(shot), shot);
		assert.deepEqual(r.out["summary"], {
			nodes: 5,
			components: 2,
			variables: 1,
			styles: 0,
			noCodeMapping: 1,
			unmapped: 2,
		});
		const off = await read({ nodeId: "10:1", screenshot: false });
		assert.equal(off.out["screenshotPath"], null);
	});

	it("el contexto no se usa para escribir en Figma: es una lectura con su job y sin nodos tocados", async () => {
		const r = await read({ nodeId: "10:1" });
		assert.match(String(r.out["jobId"]), /./);
		assert.equal(r.out["status"], "done");
		assert.deepEqual(r.out["touchedNodeIds"], []);
	});
});

describe("E94 · recorte y avisos", () => {
	it("con `maxNodes` corta y deja en `truncated.children` los ids que faltan", async () => {
		const r = await read({ nodeId: "10:1", maxNodes: 2, screenshot: false });
		assert.equal(r.out["ok"], true);
		assert.deepEqual(r.out["truncated"], { reason: "max-nodes", missing: 3 });
		const context = contextOf(r.out);
		assert.equal(context.nodes.length, 2);
		assert.deepEqual(context.truncated?.children, ["10:7", "10:8", "10:9"]);
	});

	it("un set sin hoja da NO_CODE_MAPPING, y el color y la fuente sueltos salen en `unmapped`", async () => {
		const r = await read({ nodeId: "10:1", screenshot: false });
		const warnings = r.out["warnings"] as Json[];
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0]?.["code"], "NO_CODE_MAPPING");
		assert.equal(warnings[0]?.["component"], "k-aviso");
		assert.equal(contextOf(r.out).components["k-aviso"]?.code, undefined);
		assert.deepEqual(r.out["unmapped"], [
			{ node: "10:8", name: "Título", fields: ["text.font"] },
			{ node: "10:9", name: "Fondo suelto", fields: ["fills"] },
		]);
	});

	it("R-1: un set sin la clave fcc:sheet: pero con una hoja del mismo título sale con `code.by: name`", async () => {
		const r = await read({ nodeId: "10:5", screenshot: false });
		assert.equal(r.out["ok"], true);
		const brand = contextOf(r.out).components["k-marca"];
		assert.deepEqual(brand?.code, {
			source: "plantillas/marca.html",
			tag: '<span class="marca">',
			by: "name",
		});
		assert.equal(brand?.sheet, "marca");
		assert.deepEqual(r.out["warnings"], []);
	});

	it("R-3: un set como raíz recorre solo una variante y da las demás como tabla; una variante que no existe es ContractError", async () => {
		const set = await read({ nodeId: "20:1", screenshot: false });
		assert.equal(set.out["ok"], true);
		const context = contextOf(set.out);
		assert.deepEqual(
			context.nodes.map((n) => n.type),
			["COMPONENT_SET", "COMPONENT"],
		);
		assert.deepEqual(context.components["k-boton"]?.variants, {
			Tamaño: ["S", "M"],
			Tipo: ["Primario", "Secundario"],
		});
		assert.deepEqual(context.origin, { kind: "sheet", key: "marca" });

		const ok = await read({
			nodeId: "20:1",
			variant: { Tamaño: "M" },
			screenshot: false,
		});
		assert.equal(ok.out["ok"], true);

		const bad = await read({
			nodeId: "20:1",
			variant: { Tamaño: "XL" },
			screenshot: false,
		});
		assert.equal(bad.isError, true);
		assert.equal(bad.out["ok"], false);
		const error = bad.out["error"] as Json;
		assert.equal(error["type"], "ContractError");
		assert.equal(bad.out["retryable"], false);
		assert.match(String(error["message"]), /S, M/);
		assert.match(String(error["message"]), /XL/);
	});

	it("un nodo que no existe es NodeNotFound, como resultado", async () => {
		const r = await read({ nodeId: "99:99", screenshot: false });
		assert.equal(r.isError, true);
		assert.equal((r.out["error"] as Json)["type"], "NodeNotFound");
		assert.equal(r.out["path"], null);
	});
});
