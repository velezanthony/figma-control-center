// E66 a E69 áreas como datos: pasos `use` en un manifiesto, `figma_build
// { areas }`, areas@1 inválido sin job y el informe de enlaces. Servidor MCP real + SQLite con `example-mini` y su areas.json,
// con el simulador de Figma como Chrome: el simulador reconoce el código fijo de cada paso del kit y contesta desde sus
// `params`. Sin Figma, sin el proyecto consumidor y sin el 9222.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { kitStepCode } from "#domain/step.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type Environment,
	FILE_URL,
	startEnvironment,
} from "../../harness/environment.ts";
import { exampleMiniProject } from "../../harness/example-mini.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";
import { until } from "../../harness/wait.ts";

let env: Environment | undefined;
let work: string | undefined;
afterEach(async () => {
	await env?.stop();
	if (work !== undefined) await rm(work, { recursive: true, force: true });
	env = undefined;
	work = undefined;
});

type Started = {
	claude: FakeClaudeCode;
	projectDir: string;
};

// El proyecto example-mini en una carpeta temporal, que es también su raíz de scripts (ahí van los manifiestos)
async function start(): Promise<Started & { env: Environment }> {
	work = await mkdtemp(join(tmpdir(), "figma-areas-"));
	const projectDir = join(work, "proyecto");
	const draft = await exampleMiniProject(
		projectDir,
		"http://127.0.0.1:1",
		FILE_URL,
	);
	await writeFile(
		join(projectDir, "paso.js"),
		"// @scenario: write-created\nreturn { createdNodeIds: ['10:1'] };\n",
	);
	env = await startEnvironment({
		dashboard: false,
		projects: [{ ...draft, scriptsRoots: [projectDir] }],
	});
	return { env, claude: await env.startClaude({ reply: null }), projectDir };
}

type StepOut = {
	index: number;
	file: string;
	status: string;
	warning: string | null;
};

const AREAS_FILE = "areas.json";
const readAreas = async (dir: string) =>
	JSON.parse(await readFile(join(dir, AREAS_FILE), "utf8")) as Record<
		string,
		any
	>;
const writeAreas = (dir: string, value: unknown) =>
	writeFile(join(dir, AREAS_FILE), JSON.stringify(value));

const KIT_EXPRESSION = /kit\.steps\.(\w+)\(params, assets\)/;
const kitExpressions = (e: Environment) =>
	(e.simulator?.expressions ?? []).filter((x) => KIT_EXPRESSION.test(x));
const paramsOf = (expression: string) =>
	JSON.parse(
		/const params = (.*);const assets = /.exec(expression)?.[1] ?? "null",
	) as { area: { name: string }; shared: { name: string }[] };

const MANIFEST = {
	name: "areas",
	steps: [
		{ file: "paso.js" },
		{ use: "kit/place@1", area: "Panel" },
		{ use: "kit/links@1", area: "Panel" },
		{ use: "kit/fill-image@1", area: "Panel" },
	],
};

describe("E66 · pasos `use` en un manifiesto", () => {
	it("un manifiesto con un `file` y tres `use` corre; cada `use` llega con los params de su área y el código fijo, con su etiqueta en el progreso y en el histórico", async () => {
		const { env: e, claude, projectDir } = await start();
		await writeFile(join(projectDir, "lote.json"), JSON.stringify(MANIFEST));

		const started = await claude.callTool(TOOL_NAME.build, {
			manifest: join(projectDir, "lote.json"),
		});
		assert.equal(started.isError, false);
		const labels = (started.out["steps"] as StepOut[]).map((s) => s.file);
		assert.deepEqual(labels.slice(1), [
			"kit/place@1 · Panel",
			"kit/links@1 · Panel",
			"kit/fill-image@1 · Panel",
		]);
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "done");

		// el código fijo y los params del área
		const sent = kitExpressions(e);
		assert.equal(sent.length, 3);
		assert.ok(sent[0]?.includes(kitStepCode("kit/place@1")));
		for (const expression of sent) {
			const params = paramsOf(expression);
			assert.equal(params.area.name, "Panel");
			assert.deepEqual(
				params.shared.map((g) => g.name),
				["Perfil"],
			);
		}

		// la etiqueta en el histórico de la llamada y en los intentos
		await until(
			"el histórico guardó los cuatro pasos",
			() =>
				e.rows("SELECT 1 FROM build_steps WHERE status = 'done'").length === 4,
		);
		const calls = e.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const call = await claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[0]?.call_id,
		});
		assert.deepEqual(
			(call.out["steps"] as StepOut[]).slice(1).map((s) => s.file),
			labels.slice(1),
		);
		const targets = await claude.callTool(TOOL_NAME.historyAttempts, {});
		const names = (
			targets.out["items"] as { target: string; attempts: number }[]
		).map((t) => t.target);
		for (const label of labels.slice(1))
			assert.ok(names.includes(label), label);
	});

	it("cambiar areas.json deja «cambió params» (y solo params) en el siguiente intento del mismo paso", async () => {
		const { claude, projectDir } = await start();
		await writeFile(join(projectDir, "lote.json"), JSON.stringify(MANIFEST));
		const run = async () => {
			const r = await claude.callTool(TOOL_NAME.build, {
				manifest: join(projectDir, "lote.json"),
			});
			assert.equal(r.isError, false);
			assert.equal(
				(await claude.waitJob(String(r.out["jobId"]))).out["status"],
				"done",
			);
		};
		await run();
		const areas = await readAreas(projectDir);
		areas["areas"][0].frame.width = 1280;
		await writeAreas(projectDir, areas);
		await run();

		const list = await claude.callTool(TOOL_NAME.historyAttempts, {
			target: "kit/place@1 · Panel",
		});
		const items = list.out["items"] as {
			n: number;
			changed: string[] | null;
			change: string;
			kind: string;
		}[];
		assert.deepEqual(
			items.map((i) => i.n),
			[1, 2],
		);
		assert.equal(items[0]?.kind, "build_step");
		assert.deepEqual(items[1]?.changed, ["params"]);
		assert.match(items[1]?.change ?? "", /cambió params/);
	});

	it("un paso `use` con `file` o con `params` rechaza el manifiesto entero sin job", async () => {
		const { env: e, claude, projectDir } = await start();
		await writeFile(
			join(projectDir, "malo.json"),
			JSON.stringify({
				steps: [{ use: "kit/place@1", area: "Panel", params: { a: 1 } }],
			}),
		);
		const r = await claude.callTool(TOOL_NAME.build, {
			manifest: join(projectDir, "malo.json"),
		});
		assert.equal(r.isError, true);
		assert.equal(r.out["jobId"] ?? null, null);
		assert.equal(e.rows("SELECT 1 FROM jobs").length, 0);
	});
});

describe("E67 · figma_build { areas }", () => {
	it("arma place → share → links → fill-image para un área y el mismo plan que el manifiesto de E66", async () => {
		const { claude, projectDir } = await start();
		await writeFile(
			join(projectDir, "lote.json"),
			JSON.stringify({
				steps: [
					"kit/place@1",
					"kit/share@1",
					"kit/links@1",
					"kit/fill-image@1",
				].map((use) => ({ use, area: "Panel" })),
			}),
		);
		const byAreas = await claude.callTool(TOOL_NAME.build, {
			areas: ["Panel"],
		});
		assert.equal(byAreas.isError, false);
		await claude.waitJob(String(byAreas.out["jobId"]));
		const byManifest = await claude.callTool(TOOL_NAME.build, {
			manifest: join(projectDir, "lote.json"),
		});
		await claude.waitJob(String(byManifest.out["jobId"]));
		const files = (r: { out: Record<string, unknown> }) =>
			(r.out["steps"] as StepOut[]).map((s) => s.file);
		assert.deepEqual(files(byAreas), [
			"kit/place@1 · Panel",
			"kit/share@1 · Panel",
			"kit/links@1 · Panel",
			"kit/fill-image@1 · Panel",
		]);
		assert.deepEqual(files(byAreas), files(byManifest));
	});

	it("con dos áreas, en el orden de la lista (Portada solo tiene place)", async () => {
		const { claude } = await start();
		const r = await claude.callTool(TOOL_NAME.build, {
			areas: ["Portada", "Panel"],
		});
		assert.deepEqual(
			(r.out["steps"] as StepOut[]).map((s) => s.file),
			[
				"kit/place@1 · Portada",
				"kit/place@1 · Panel",
				"kit/share@1 · Panel",
				"kit/links@1 · Panel",
				"kit/fill-image@1 · Panel",
			],
		);
		await claude.waitJob(String(r.out["jobId"]));
	});

	it("un área desconocida es un error de uso sin job y sin enviar nada a la pestaña", async () => {
		const { env: e, claude } = await start();
		const r = await claude.callTool(TOOL_NAME.build, { areas: ["Nada"] });
		assert.equal(r.isError, true);
		assert.match(r.text, /«Nada».*Panel, Portada/);
		assert.equal(e.rows("SELECT 1 FROM jobs").length, 0);
		assert.deepEqual(kitExpressions(e), []);
	});
});

describe("E68 · areas@1 inválido", () => {
	// Cada caso estropea el proyecto, comprueba que el lote se rechaza sin job, sin lock y sin enviar nada, y lo repone: el
	// mismo lote corre justo después (no quedó ningún lock a medias)
	const broken = async (
		edit: (dir: string, areas: Record<string, any>) => Promise<void>,
		expectError: (error: Record<string, unknown>) => void,
	) => {
		const { env: e, claude, projectDir } = await start();
		const original = await readAreas(projectDir);
		const config = await readFile(
			join(projectDir, "figma-control-center.json"),
			"utf8",
		);
		await edit(projectDir, structuredClone(original));

		const r = await claude.callTool(TOOL_NAME.build, { areas: ["Panel"] });
		assert.equal(r.isError, true);
		assert.equal(r.out["jobId"] ?? null, null);
		expectError(r.out["error"] as Record<string, unknown>);
		assert.equal(e.rows("SELECT 1 FROM jobs").length, 0);
		assert.deepEqual(kitExpressions(e), [], "nada llegó a la pestaña");

		await writeAreas(projectDir, original);
		await writeFile(join(projectDir, "figma-control-center.json"), config);
		const ok = await claude.callTool(TOOL_NAME.build, { areas: ["Panel"] });
		assert.equal(ok.isError, false);
		await claude.waitJob(String(ok.out["jobId"]));
	};

	it("un esquema roto: ContractError con el puntero", () =>
		broken(
			(dir, areas) => {
				areas["areas"][0].place.mode = "graft";
				return writeAreas(dir, areas);
			},
			(error) => {
				assert.equal(error["type"], "ContractError");
				assert.equal(error["path"], "/areas/0/place/mode");
			},
		));

	it("un frame de enlace que no existe: ContractError con el puntero del enlace", () =>
		broken(
			(dir, areas) => {
				areas["areas"][0].links[0].to = "Nada";
				return writeAreas(dir, areas);
			},
			(error) => {
				assert.equal(error["type"], "ContractError");
				assert.equal(error["path"], "/areas/0/links/0/to");
			},
		));

	it("una `screen` que no está en screens@1: ContractError con el puntero", () =>
		broken(
			(dir, areas) => {
				areas["areas"][0].screens[0].screen = "no-esta";
				return writeAreas(dir, areas);
			},
			(error) => {
				assert.equal(error["type"], "ContractError");
				assert.equal(error["path"], "/areas/0/screens/0/screen");
			},
		));

	it("un proyecto sin `areas`: ProjectConfigError con el campo `areas`", () =>
		broken(
			async (dir) => {
				const file = join(dir, "figma-control-center.json");
				const config = JSON.parse(await readFile(file, "utf8")) as Record<
					string,
					unknown
				>;
				delete config["areas"];
				await writeFile(file, JSON.stringify(config));
			},
			(error) => {
				assert.equal(error["type"], "ProjectConfigError");
				assert.equal(error["field"], "areas");
			},
		));
});

describe("E69 · informe de enlaces", () => {
	it("un enlace con cuenta 0 sale como LINK_ZERO en el warning del paso, en la respuesta del lote y al preguntar por el job; el informe entero queda en el resultado del paso del histórico", async () => {
		const { env: e, claude } = await start();
		const started = await claude.callTool(TOOL_NAME.build, {
			areas: ["Panel"],
		});
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "done");
		const links = (end.out["steps"] as StepOut[]).find((s) =>
			s.file.startsWith("kit/links@1"),
		);
		assert.match(
			links?.warning ?? "",
			/LINK_ZERO: Inicio: Botón que no existe → Detalle ×0/,
		);
		const place = (end.out["steps"] as StepOut[]).find((s) =>
			s.file.startsWith("kit/place@1"),
		);
		assert.equal(place?.warning, null);
		assert.equal(
			"report" in (links ?? {}),
			false,
			"el informe no viaja en la respuesta",
		);

		await until(
			"el histórico guardó los pasos",
			() =>
				e.rows("SELECT 1 FROM build_steps WHERE status = 'done'").length === 4,
		);
		const calls = e.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const index = (end.out["steps"] as StepOut[]).indexOf(links as StepOut);
		const full = await claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[0]?.call_id,
			step: index,
		});
		const stepResult = full.out["stepResult"] as {
			result: { kind: string; value?: unknown };
		};
		assert.equal(stepResult.result.kind, "inline");
		const result = stepResult.result.value as {
			report?: { links?: { text?: string; rows?: true; count: number }[] };
		};
		assert.deepEqual(
			result.report?.links?.map((l) => [l.text ?? "filas", l.count]),
			[
				["Ver detalle", 1],
				["Botón que no existe", 0],
				["filas", 2],
			],
		);
	});
});
