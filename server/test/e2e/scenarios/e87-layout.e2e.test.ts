// E87 maquetación: `{ use: "kit/layout-check@1", area }` en `steps` y en un manifiesto deja `report.layout`
// en el histórico, sin escribir en Figma; `figma_build { areas }` no lo añade solo (D-10). La parte de `figma_audit` queda para
// F5a. Servidor MCP real + SQLite con `example-mini`, con el simulador de Figma como Chrome. Sin Figma ni el proyecto consumidor.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function start(): Promise<{
	env: Environment;
	claude: FakeClaudeCode;
	projectDir: string;
}> {
	work = await mkdtemp(join(tmpdir(), "figma-layout-"));
	const projectDir = join(work, "proyecto");
	const draft = await exampleMiniProject(
		projectDir,
		"http://127.0.0.1:1",
		FILE_URL,
	);
	env = await startEnvironment({
		dashboard: false,
		projects: [{ ...draft, scriptsRoots: [projectDir] }],
	});
	return { env, claude: await env.startClaude({ reply: null }), projectDir };
}

type StepOut = { file: string; status: string };
type Layout = {
	area: string;
	frame: string;
	overlaps: number;
	collapsed: number;
	misalignedRows: number;
};

const KIT_EXPRESSION = /kit\.steps\.(\w+)\(params, assets\)/;
const kitCalls = (e: Environment) =>
	(e.simulator?.expressions ?? []).filter((x) => KIT_EXPRESSION.test(x));

describe("E87 · maquetación", () => {
	it("`steps` con `kit/layout-check@1` corre con el código fijo y los params del área, y el informe entero queda en el histórico", async () => {
		const { env: e, claude } = await start();
		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [{ use: "kit/layout-check@1", area: "Panel" }],
		});
		assert.equal(started.isError, false);
		assert.deepEqual(
			(started.out["steps"] as StepOut[]).map((s) => s.file),
			["kit/layout-check@1 · Panel"],
		);
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "done");
		assert.ok(kitCalls(e)[0]?.includes(kitStepCode("kit/layout-check@1")));

		await until(
			"el histórico guardó el paso",
			() =>
				e.rows("SELECT 1 FROM build_steps WHERE status = 'done'").length === 1,
		);
		const calls = e.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const full = await claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[0]?.call_id,
			step: 0,
		});
		const stepResult = full.out["stepResult"] as {
			result: {
				kind: string;
				value?: {
					mutatedNodeIds: string[];
					report?: { layout?: Layout[] };
				};
			};
		};
		assert.equal(stepResult.result.kind, "inline");
		assert.deepEqual(
			stepResult.result.value?.report?.layout?.map((l) => [
				l.area,
				l.frame,
				l.overlaps,
				l.collapsed,
				l.misalignedRows,
			]),
			[
				["Panel", "Inicio", 0, 0, 0],
				["Panel", "Detalle", 0, 0, 0],
			],
		);
		assert.deepEqual(stepResult.result.value?.mutatedNodeIds, []);
	});

	it("también vale en un manifiesto, junto a otros pasos del kit", async () => {
		const { claude, projectDir } = await start();
		await writeFile(
			join(projectDir, "lote.json"),
			JSON.stringify({
				name: "revisión",
				steps: [
					{ use: "kit/links@1", area: "Panel" },
					{ use: "kit/layout-check@1", area: "Panel" },
				],
			}),
		);
		const started = await claude.callTool(TOOL_NAME.build, {
			manifest: join(projectDir, "lote.json"),
		});
		assert.equal(started.isError, false);
		assert.deepEqual(
			(started.out["steps"] as StepOut[]).map((s) => s.file),
			["kit/links@1 · Panel", "kit/layout-check@1 · Panel"],
		);
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "done");
	});

	it("`figma_build { areas }` no lo añade solo (D-10)", async () => {
		const { claude } = await start();
		const started = await claude.callTool(TOOL_NAME.build, {
			areas: ["Panel"],
		});
		const labels = (started.out["steps"] as StepOut[]).map((s) => s.file);
		assert.equal(
			labels.some((l) => l.startsWith("kit/layout-check@1")),
			false,
		);
		await claude.waitJob(String(started.out["jobId"]));
	});
});
