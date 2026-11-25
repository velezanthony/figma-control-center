// E99 a E101: diseñar en Figma sin web previa con `kit/compose@1`. Servidor MCP
// real con el proyecto `example-mini` (su carpeta `compose/` y su sheets@1) y el simulador de Figma, que reconoce el código fijo
// del paso y contesta desde sus params. El pintor de verdad se prueba contra el doble del API de plugins
// (server/test/kits/figma/pure/step-compose.test.ts) y contra Figma real (make kit-contract). Sin el proyecto consumidor y sin el 9222.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { DesignContextSchema } from "#adapters/contracts/design-context.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	componentsValue,
	designReadValue,
} from "../../contracts/figma-values.ts";
import { DEFAULT_WORLD, type World } from "../../fixtures/scenarios/world.ts";
import {
	type Environment,
	FILE_URL,
	startEnvironment,
} from "../../harness/environment.ts";
import { exampleMiniProject } from "../../harness/example-mini.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";

const FRAME = "23:2";
const BOX = { x: 0, y: 0, w: 480, h: 200 };

// El archivo del simulador con el set «Marca» que usa la hoja `marca` y el frame que pintaría el compose `card`
const BRAND = componentsValue({
	components: [
		{
			id: "30:1",
			key: "k-marca",
			name: "Marca",
			type: "COMPONENT_SET",
			page: "   Marca",
			pageIndex: 2,
			description: "",
			variants: { tamano: ["sm", "lg"] },
			properties: [
				{ name: "etiqueta#1:0", type: "TEXT", defaultValue: "Marca" },
			],
			variantCount: 2,
		},
	],
}).components;
const WORLD: World = {
	...DEFAULT_WORLD,
	catalog: {
		...DEFAULT_WORLD.catalog,
		components: [...DEFAULT_WORLD.catalog.components, ...BRAND],
		designContexts: new Map([
			...DEFAULT_WORLD.catalog.designContexts,
			[
				FRAME,
				{
					read: designReadValue({
						fileName: "Archivo de ejemplo",
						root: FRAME,
						origin: { kind: "compose", key: "card" },
						nodes: [
							{
								id: FRAME,
								parent: null,
								name: "Ficha de ejemplo",
								type: "FRAME",
								visible: true,
								box: BOX,
								fills: [{ variable: "VariableID:2:2" }],
							},
							{
								id: "23:3",
								parent: FRAME,
								name: "Marca",
								type: "INSTANCE",
								visible: true,
								box: BOX,
								instance: {
									component: "k-marca",
									variant: { tamano: "sm" },
									props: { etiqueta: "Marca de ejemplo" },
									overridden: [],
								},
							},
						],
						variables: {
							"VariableID:2:2": {
								name: "color/fondo",
								collection: "Tokens",
								type: "COLOR",
								value: { r: 1, g: 1, b: 1, a: 1 },
							},
						},
						styles: {},
						components: {
							"k-marca": {
								name: "Marca",
								kind: "COMPONENT_SET",
								key: "k-marca",
								remote: false,
								variants: { tamano: ["sm", "lg"] },
								properties: [],
							},
						},
					}),
				},
			],
		]),
	},
};

let work: string;
let env: Environment;
let claude: FakeClaudeCode;
before(async () => {
	work = await mkdtemp(join(tmpdir(), "example-mini-"));
	const project = await exampleMiniProject(
		join(work, "proyecto"),
		"http://127.0.0.1:1",
		FILE_URL,
	);
	env = await startEnvironment({
		dashboard: false,
		projects: [project],
		world: WORLD,
	});
	claude = await env.startClaude({ reply: null });
});
after(async () => {
	await env?.stop();
	await rm(work, { recursive: true, force: true });
});

type Json = Record<string, any>;
const COMPOSE_CALL = /kit\.steps\.compose\(params, assets\)/;
const paintsSent = () =>
	(env.simulator?.expressions ?? []).filter((x) => COMPOSE_CALL.test(x));
const paramsOf = (expression: string): Json => {
	const line = /^\(async \(\) => \{const params = (.*);const assets = /m.exec(
		expression,
	);
	assert.ok(line?.[1], "los params no están en el código enviado");
	return JSON.parse(line[1]) as Json;
};

async function build(compose: string) {
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [{ use: "kit/compose@1", compose }],
	});
	if (started.isError || started.out["jobId"] === undefined) {
		return { started, end: null };
	}
	return { started, end: await claude.waitJob(String(started.out["jobId"])) };
}

describe("E99 · compose válido", () => {
	it("pinta el frame por clave con el código fijo y el compose y sus hojas como params", async () => {
		const { started, end } = await build("card");
		assert.equal(started.isError, false, started.text);
		assert.equal(
			(started.out["steps"] as { file: string }[])[0]?.file,
			"kit/compose@1 · card",
		);
		assert.equal(end?.out["status"], "done", end?.text ?? "");
		assert.ok(((end?.out["touchedNodeIds"] ?? []) as string[]).includes(FRAME));
		const [sent] = paintsSent();
		const params = paramsOf(sent ?? "");
		assert.equal(params["compose"].key, "card");
		assert.equal(params["compose"].target.page, "Pruebas");
		assert.deepEqual(params["sheets"], [{ key: "marca", title: "Marca" }]);
	});

	it("relanzarlo rehace el mismo frame: no crea otro", async () => {
		const { end } = await build("card");
		assert.equal(end?.out["status"], "done", end?.text ?? "");
		const touched = (end?.out["touchedNodeIds"] ?? []) as string[];
		assert.ok(touched.includes(FRAME));
		const calls = env.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build' ORDER BY rowid",
		);
		const call = await claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[calls.length - 1]?.call_id,
			step: 0,
		});
		assert.equal(call.isError, false, call.text);
		const result = (call.out["stepResult"] as Json)["result"];
		assert.equal(result.kind, "inline");
		const { report, createdNodeIds, mutatedNodeIds } = result.value as Json;
		assert.equal(report.rebuilt, true);
		assert.equal(createdNodeIds.includes(FRAME), false);
		assert.deepEqual(mutatedNodeIds, [FRAME]);
		assert.equal(report.frameId, FRAME);
	});

	it("el intento guarda el compose y el sheets.json que usó, sin map", async () => {
		const attempts = await claude.callTool(TOOL_NAME.historyAttempts, {
			target: "kit/compose@1 · card",
		});
		assert.equal(attempts.isError, false, attempts.text);
		const [first] = attempts.out["items"] as {
			kind: string;
			scripts: { role: string }[];
		}[];
		assert.equal(first?.kind, "build_step");
		assert.deepEqual(first?.scripts.map((s) => s.role).sort(), [
			"kit",
			"params",
			"plan",
			"sheets",
			"step",
		]);
	});
});

describe("E100 · compose inválido", () => {
	const nothingPainted = () => assert.equal(paintsSent().length, 2);

	it("un color suelto y una hoja que no existe: ContractError con puntero, sin job y sin tocar la pestaña", async () => {
		const before = (env.simulator?.expressions ?? []).length;
		const jobs = env.rows("SELECT 1 FROM jobs").length;
		const { started } = await build("broken");
		assert.equal(started.isError, true);
		assert.equal(started.out["jobId"] ?? null, null);
		assert.equal((started.out["error"] as Json)["type"], "ContractError");
		assert.equal((started.out["error"] as Json)["path"], "/root/fill");
		assert.match(started.text, /\/root\/children\/0\/use/);
		assert.match(started.text, /valor suelto/);
		assert.equal(env.rows("SELECT 1 FROM jobs").length, jobs);
		assert.equal(
			(env.simulator?.expressions ?? []).length,
			before,
			"ni una llamada al simulador",
		);
		nothingPainted();
	});

	it("una variante, una variable y un estilo que no existen se dicen tras leer el catálogo, sin ningún paso que escriba", async () => {
		const { started } = await build("catalog");
		assert.equal(started.isError, true);
		assert.equal(started.out["jobId"] ?? null, null);
		assert.match(started.text, /\/root\/gap/);
		assert.match(started.text, /\/root\/children\/0\/style/);
		assert.match(started.text, /\/root\/children\/1\/variant\/tamano/);
		nothingPainted();
	});

	it("un compose que no existe o con una clave que sale de la carpeta es un error de uso, sin job", async () => {
		const missing = await build("nada");
		assert.equal(missing.started.isError, true);
		assert.match(missing.started.text, /nada\.json/);
		const bad = await build("../card");
		assert.equal(bad.started.isError, true);
		assert.match(bad.started.text, /clave de compose válida/);
		nothingPainted();
	});
});

describe("E101 · de ida y vuelta", () => {
	it("figma_design_context del frame pintado da origin compose y el código de cada hoja, sin valores sueltos", async () => {
		const r = await claude.callTool(TOOL_NAME.designContext, {
			nodeId: FRAME,
			screenshot: false,
		});
		assert.equal(r.isError, false, r.text);
		const context = DesignContextSchema.parse(
			JSON.parse(readFileSync(String(r.out["path"]), "utf8")),
		);
		assert.deepEqual(context.origin, { kind: "compose", key: "card" });
		assert.deepEqual(context.components["k-marca"]?.code, {
			source: "plantillas/marca.html",
			tag: '<span class="marca">',
			by: "name",
		});
		assert.deepEqual(r.out["unmapped"], []);
		assert.deepEqual(r.out["warnings"], []);
	});
});
