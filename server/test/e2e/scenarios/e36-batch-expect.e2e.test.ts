// E36 `expect` del lote: el nombre del archivo abierto se exige antes de enviar nada, también al reanudar con fromStep.
// Servidor MCP real + SQLite, con el simulador de Figma como Chrome. Sin Figma ni Chrome.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { DEFAULT_WORLD } from "../../fixtures/scenarios/world.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";

const STEP_KEYS = ["buildStepOkA", "buildStepOkB", "buildStepOkC"] as const;
const SCENARIO_MARKER = "@scenario: build-step";

let env: Environment;
let dir: string | undefined;
afterEach(async () => {
	await env?.stop();
	if (dir !== undefined) await rm(dir, { recursive: true, force: true });
	dir = undefined;
});

const manifestWith = async (expect: unknown) => {
	dir = await mkdtemp(join(tmpdir(), "figma-expect-"));
	for (const key of STEP_KEYS) {
		await copyFile(
			scenarioPath(SCENARIOS[key].script),
			join(dir, SCENARIOS[key].script),
		);
	}
	await writeFile(
		join(dir, "lote.json"),
		JSON.stringify({
			name: "area",
			expect,
			steps: STEP_KEYS.map((key) => ({ file: SCENARIOS[key].script })),
		}),
	);
	return dir;
};

describe("E36 · expect del lote", () => {
	for (const fromStep of [0, 2]) {
		it(`un nombre que no coincide se rechaza como error de uso, sin job y sin enviar ningún script (fromStep ${fromStep})`, async () => {
			const root = await manifestWith({ fileName: "Otro archivo" });
			env = await startEnvironment({ dashboard: false, scriptsRoot: root });
			const claude = await env.startClaude({ reply: null });

			const r = await claude.callTool(TOOL_NAME.build, {
				manifest: join(root, "lote.json"),
				fromStep,
			});

			assert.equal(r.isError, true);
			assert.match(r.text, new RegExp(`«${DEFAULT_WORLD.file}»`));
			assert.match(r.text, /«Otro archivo»/);
			assert.equal(r.out["jobId"] ?? null, null);
			const sent = (env.simulator?.expressions ?? []).filter((e) =>
				e.includes(SCENARIO_MARKER),
			);
			assert.deepEqual(sent, [], "ningún paso llegó al simulador");
			assert.equal(env.rows("SELECT 1 FROM jobs").length, 0);

			// Sin lock a medias: el mismo lote con el nombre correcto corre
			const ok = await claude.callTool(TOOL_NAME.build, {
				manifest: join(root, "lote.json"),
				expect: { fileName: DEFAULT_WORLD.file },
				fromStep,
			});
			assert.equal(ok.isError, false);
			const end = await claude.waitJob(String(ok.out["jobId"]));
			assert.equal(end.out["status"], "done");
		});
	}

	it("con el nombre correcto el lote corre igual que sin expect", async () => {
		const root = await manifestWith({ fileName: DEFAULT_WORLD.file });
		env = await startEnvironment({ dashboard: false, scriptsRoot: root });
		const claude = await env.startClaude({ reply: null });

		const started = await claude.callTool(TOOL_NAME.build, {
			manifest: join(root, "lote.json"),
			fromStep: 1,
		});
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "done");
		assert.deepEqual(
			(end.out["steps"] as { status: string }[]).map((s) => s.status),
			["skipped", "done", "done"],
		);
	});
});
