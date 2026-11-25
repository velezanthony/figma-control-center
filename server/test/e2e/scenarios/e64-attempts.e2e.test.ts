// E64 intentos: tres figma_run_script del mismo fichero cambiándolo en el tercero dejan los
// intentos 1 a 3 y «cambió step» solo en el 3; los dos primeros comparten contenido; figma_history_script escribe el
// contenido exacto; un lote de dos pasos deja un intento por paso con jobId y stepIndex; figma_history_call los lista;
// otro proyecto no los ve. Servidor MCP real + SQLite, con el simulador de Figma.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { FIGMA_KIT_BUNDLE_PATH } from "#adapters/cdp/figma-kit.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type CaptureEnvironment,
	startCaptureEnvironment,
} from "../../harness/capture-environment.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";

let env: Environment;
let root: string | undefined;
afterEach(async () => {
	await env?.stop();
	if (root !== undefined) await rm(root, { recursive: true, force: true });
	root = undefined;
});

type Attempt = {
	id: number;
	n: number;
	kind: string;
	target: string;
	status: string;
	callId: string | null;
	jobId: string | null;
	stepIndex: number | null;
	kit: string;
	changed: string[] | null;
	change: string;
	scripts: { role: string; sha256: string; stored: string }[];
};

const SCRIPT =
	"// @scenario: write-created\nreturn { createdNodeIds: ['10:1'] };\n";

async function start(extraEnv: Record<string, string> = {}) {
	root = await mkdtemp(join(tmpdir(), "figma-intentos-"));
	await writeFile(join(root, "paso.js"), SCRIPT);
	for (const key of ["buildStepOkA", "buildStepOkB"] as const) {
		await copyFile(
			scenarioPath(SCENARIOS[key].script),
			join(root, SCENARIOS[key].script),
		);
	}
	env = await startEnvironment({
		dashboard: false,
		scriptsRoot: root,
		extraEnv,
	});
	return { root, claude: await env.startClaude({ reply: null }) };
}

describe("E64 · intentos", () => {
	it("tres ejecuciones del mismo fichero, cambiado en la tercera: intentos 1 a 3, «cambió step» solo en el 3 y contenido compartido en los dos primeros", async () => {
		const { root: dir, claude } = await start();
		const run = () =>
			claude.callTool(TOOL_NAME.runScript, {
				file: join(dir, "paso.js"),
				format: "body",
			});
		assert.equal((await run()).isError, false);
		assert.equal((await run()).isError, false);
		await writeFile(join(dir, "paso.js"), `${SCRIPT}// ahora cambia\n`);
		assert.equal((await run()).isError, false);

		const targets = await claude.callTool(TOOL_NAME.historyAttempts, {});
		assert.equal(targets.out["mode"], "targets");
		assert.deepEqual(
			(
				targets.out["items"] as {
					target: string;
					attempts: number;
					lastStatus: string;
				}[]
			).map((t) => [t.target, t.attempts, t.lastStatus]),
			[["paso.js", 3, "ok"]],
		);

		const list = await claude.callTool(TOOL_NAME.historyAttempts, {
			target: "paso",
		});
		const items = list.out["items"] as Attempt[];
		assert.deepEqual(
			items.map((i) => i.n),
			[1, 2, 3],
		);
		assert.deepEqual(
			items.map((i) => i.changed),
			[null, [], ["step"]],
		);
		assert.equal(items[2]?.change, "intento 3: cambió step; kit igual");
		assert.deepEqual(
			items.map((i) => i.kit),
			["figma-kit@1", "figma-kit@1", "figma-kit@1"],
		);
		assert.equal(items[0]?.kind, "run_script");
		assert.ok(items.every((i) => i.callId !== null));

		const step = (a: Attempt) =>
			a.scripts.find((s) => s.role === "step")?.sha256;
		assert.equal(
			step(items[0] as Attempt),
			step(items[1] as Attempt),
			"los dos primeros comparten contenido",
		);
		assert.notEqual(step(items[1] as Attempt), step(items[2] as Attempt));
		assert.equal(
			env.rows<{ n: number }>(
				"SELECT count(*) AS n FROM script_blobs WHERE kind = 'js'",
			)[0]?.n,
			3,
			"dos versiones del script y el kit",
		);
		assert.equal(env.rows("SELECT 1 FROM attempts").length, 3);
	});

	it("figma_history_script escribe el contenido exacto de cada versión y del kit; la respuesta no lo trae", async () => {
		const { root: dir, claude } = await start();
		const run = () =>
			claude.callTool(TOOL_NAME.runScript, {
				file: join(dir, "paso.js"),
				format: "body",
			});
		await run();
		const changed = `${SCRIPT}// ahora cambia\n`;
		await writeFile(join(dir, "paso.js"), changed);
		await run();
		const items = (
			await claude.callTool(TOOL_NAME.historyAttempts, { target: "paso.js" })
		).out["items"] as Attempt[];

		const first = await claude.callTool(TOOL_NAME.historyScript, {
			attempt: items[0]?.id,
			role: "step",
		});
		assert.equal(first.isError, false);
		assert.equal(await readFile(String(first.out["path"]), "utf8"), SCRIPT);
		assert.equal(first.out["bytes"], Buffer.byteLength(SCRIPT));
		assert.doesNotMatch(first.text, /createdNodeIds/);
		const second = await claude.callTool(TOOL_NAME.historyScript, {
			attempt: items[1]?.id,
			role: "step",
		});
		assert.equal(await readFile(String(second.out["path"]), "utf8"), changed);
		assert.match(
			String(first.out["path"]),
			/history-scripts[\\/][0-9a-f]{64}\.js$/,
		);

		const kit = await claude.callTool(TOOL_NAME.historyScript, {
			attempt: items[0]?.id,
			role: "kit",
		});
		assert.equal(
			await readFile(String(kit.out["path"]), "utf8"),
			await readFile(FIGMA_KIT_BUNDLE_PATH, "utf8"),
			"el kit queda en el historial tal como se instaló",
		);
		const noRole = await claude.callTool(TOOL_NAME.historyScript, {
			attempt: items[0]?.id,
			role: "hooks",
		});
		assert.equal(noRole.isError, true);
	});

	it("un lote de dos pasos deja un intento por paso con jobId y stepIndex, y figma_history_call los lista", async () => {
		const { root: dir, claude } = await start();
		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				{
					file: join(dir, SCENARIOS.buildStepOkA.script),
					format: "body",
					params: { x: 1 },
				},
				{ file: join(dir, SCENARIOS.buildStepOkB.script), format: "body" },
			],
		});
		const jobId = String(started.out["jobId"]);
		const end = await claude.waitJob(jobId);
		assert.equal(end.out["status"], "done");

		const callId = String(
			env.rows<{ call_id: string }>(
				"SELECT call_id FROM calls WHERE tool = 'figma_build'",
			)[0]?.call_id,
		);
		const call = await claude.callTool(TOOL_NAME.historyCall, { callId });
		const attempts = call.out["attempts"] as {
			id: number;
			n: number;
			kind: string;
			target: string;
			status: string;
		}[];
		assert.deepEqual(
			attempts.map((a) => [a.kind, a.target, a.n, a.status]),
			[
				["build_step", SCENARIOS.buildStepOkA.script, 1, "ok"],
				["build_step", SCENARIOS.buildStepOkB.script, 1, "ok"],
			],
		);

		const list = await claude.callTool(TOOL_NAME.historyAttempts, {
			kind: "build_step",
			target: "build-step",
		});
		const rows = list.out["items"] as Attempt[];
		assert.deepEqual(
			rows.map((r) => [r.target, r.jobId, r.stepIndex, r.callId]),
			[
				[SCENARIOS.buildStepOkA.script, jobId, 0, callId],
				[SCENARIOS.buildStepOkB.script, jobId, 1, callId],
			],
		);
		const params = await claude.callTool(TOOL_NAME.historyScript, {
			attempt: rows[0]?.id,
			role: "params",
		});
		assert.equal(await readFile(String(params.out["path"]), "utf8"), '{"x":1}');
	});

	it("otro proyecto no ve los intentos de este", async () => {
		// Sesión atada al proyecto 1: con un segundo proyecto en la base, sin alcance pediría elegir uno
		const { claude } = await start({ FCC_PROJECTS: "1" });
		await claude.callTool(TOOL_NAME.runScript, {
			file: join(root ?? "", "paso.js"),
			format: "body",
		});
		// Un intento del proyecto 2 en la misma base, con otro objetivo
		env.exec(
			"INSERT INTO projects (id, name, project_dir, file_url, file_key, output_dir) VALUES (2, 'otro', '/otro', 'https://www.figma.com/design/OTRO/Otro', 'OTRO', '/otro/salida')",
		);
		env.exec(
			`INSERT INTO attempts (project_id, kind, target, n, started_at, finished_at, status, kit, kit_sha256)
			 VALUES (2, 'run_script', 'ajeno.js', 1, 1, 2, 'ok', 'figma-kit@1', '${"b".repeat(64)}')`,
		);
		const mine = await claude.callTool(TOOL_NAME.historyAttempts, {});
		assert.deepEqual(
			(mine.out["items"] as { target: string }[]).map((t) => t.target),
			["paso.js"],
		);
		const theirs = await claude.callTool(TOOL_NAME.historyAttempts, {
			target: "ajeno",
		});
		assert.equal(theirs.out["total"], 0);
	});
});

describe("E64 · intentos de una captura (D-1)", () => {
	let c: CaptureEnvironment;
	before(async () => {
		c = await startCaptureEnvironment();
	});
	after(async () => {
		await c?.stop();
	});

	it("capturar `inicio` dos veces con los ganchos cambiados: intentos 1 y 2, «cambió hooks», con su entrada de screens@1 y el kit de captura", async () => {
		const capture = () =>
			c.claude.callTool(TOOL_NAME.capture, { screens: ["inicio"] });
		const first = await capture();
		assert.equal(first.isError, false, first.text);

		const projectDir = c.env.projects[0]?.projectDir ?? "";
		const hooksFile = join(projectDir, "hooks.js");
		const original = await readFile(hooksFile, "utf8");
		await writeFile(hooksFile, `${original}\n// ganchos cambiados\n`);
		const second = await capture();
		assert.equal(second.isError, false, second.text);

		const list = await c.claude.callTool(TOOL_NAME.historyAttempts, {
			target: "inicio",
			kind: "capture",
		});
		const items = list.out["items"] as Attempt[];
		assert.deepEqual(
			items.map((i) => [i.kind, i.target, i.n, i.status]),
			[
				["capture", "inicio", 1, "ok"],
				["capture", "inicio", 2, "ok"],
			],
		);
		assert.deepEqual(
			items.map((i) => i.changed),
			[null, ["hooks"]],
		);
		assert.equal(
			items[1]?.change,
			"intento 2: cambió hooks; kit y screens iguales",
		);
		assert.deepEqual(
			items.map((i) => i.kit),
			["capture-kit@1", "capture-kit@1"],
		);
		assert.ok(items.every((i) => i.jobId !== null && i.callId !== null));

		const hooks = await c.claude.callTool(TOOL_NAME.historyScript, {
			attempt: items[1]?.id,
			role: "hooks",
		});
		assert.equal(
			await readFile(String(hooks.out["path"]), "utf8"),
			`${original}\n// ganchos cambiados\n`,
		);
		const screens = await c.claude.callTool(TOOL_NAME.historyScript, {
			attempt: items[0]?.id,
			role: "screens",
		});
		assert.equal(
			(
				JSON.parse(await readFile(String(screens.out["path"]), "utf8")) as {
					key: string;
				}
			).key,
			"inicio",
		);
	});
});
