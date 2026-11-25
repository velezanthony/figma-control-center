// E21 lote entre procesos: dos sesiones de Claude Code (dos servidores MCP, dos procesos de verdad) sobre el mismo
// archivo de Figma no pueden tener un lote a la vez.
// El lock es un fichero por archivo en FCC_LOCK_DIR con el pid dentro. Sin Figma ni Chrome: simulador.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;

const step = (key: "buildStepOkA" | "buildStepOkB" | "buildStepSlow") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});
const SLOW_BUILD = {
	steps: [step("buildStepOkA"), step("buildStepSlow"), step("buildStepOkB")],
};

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

const locksDir = () => join(env.dir, "locks");
const lockFiles = () =>
	existsSync(locksDir())
		? readdirSync(locksDir()).filter((f) => f.endsWith(".lock"))
		: [];

describe("E21 · lote entre procesos", () => {
	it("mientras la sesión A tiene un lote, la B no puede lanzar otro ni un script, y lo dice; al acabar A, B puede", async () => {
		env = await startEnvironment({ dashboard: false });
		const a = await env.startClaude({ reply: null });
		const b = await env.startClaude({ reply: null });
		assert.notEqual(a.pid, b.pid);

		const started = await a.callTool(TOOL_NAME.build, SLOW_BUILD);
		assert.equal(started.out["status"], "running");

		// El fichero del lock lleva el pid del servidor de A
		assert.equal(lockFiles().length, 1);
		const lock = JSON.parse(
			readFileSync(join(locksDir(), lockFiles()[0] ?? ""), "utf8"),
		) as { pid: number; jobId: string };
		assert.equal(lock.pid, a.pid);
		assert.equal(lock.jobId, String(started.out["jobId"]));

		const blockedBuild = await b.callTool(TOOL_NAME.build, SLOW_BUILD);
		assert.equal(blockedBuild.isError, true);
		assert.match(blockedBuild.text, /otra sesión/);
		assert.match(blockedBuild.text, new RegExp(`pid ${a.pid}`));

		const blockedScript = await b.callTool(TOOL_NAME.runScript, {
			file: scenarioPath(SCENARIOS.writeCreated.script),
		});
		assert.equal(blockedScript.isError, true);
		assert.match(blockedScript.text, /otra sesión/);

		// Las lecturas no se bloquean
		const status = await b.callTool(TOOL_NAME.status, {});
		assert.equal(status.isError, false);

		await releaseGate(env.simulator, SLOW_GATE);
		await until("el lote de A termina y suelta el lock", async () => {
			const r = await a.callTool(TOOL_NAME.getJob, {
				jobId: String(started.out["jobId"]),
			});
			return r.out["status"] === "done" && lockFiles().length === 0;
		});

		env.simulator?.release(SLOW_GATE);
		const now = await b.callTool(TOOL_NAME.build, {
			steps: [step("buildStepOkA"), step("buildStepOkB")],
		});
		assert.equal(now.isError, false);
		assert.equal(
			(await b.waitJob(String(now.out["jobId"]))).out["status"],
			"done",
		);
	});

	it("al apagar la sesión A con un lote vivo, su lock se suelta y B puede", async () => {
		env = await startEnvironment({ dashboard: false });
		const a = await env.startClaude({ reply: null });
		const b = await env.startClaude({ reply: null });
		const started = await a.callTool(TOOL_NAME.build, SLOW_BUILD);
		assert.equal(started.out["status"], "running");
		assert.equal(lockFiles().length, 1);

		await a.close();
		await until(
			"el apagado de A suelta el lock",
			() => lockFiles().length === 0,
		);

		const now = await b.callTool(TOOL_NAME.build, {
			steps: [step("buildStepOkA"), step("buildStepOkB")],
		});
		assert.equal(now.isError, false);
	});

	it("si A muere a la fuerza (SIGKILL) el lock queda, pero su pid ya no existe y B lo quita", async () => {
		env = await startEnvironment({ dashboard: false });
		const a = await env.startClaude({ reply: null });
		const b = await env.startClaude({ reply: null });
		const started = await a.callTool(TOOL_NAME.build, SLOW_BUILD);
		assert.equal(started.out["status"], "running");
		const pid = a.pid;
		assert.ok(pid !== null);
		process.kill(pid, "SIGKILL");
		await until("el proceso de A ha muerto", () => {
			try {
				process.kill(pid, 0);
				return false;
			} catch {
				return true;
			}
		});
		assert.equal(lockFiles().length, 1);

		const now = await b.callTool(TOOL_NAME.build, {
			steps: [step("buildStepOkA"), step("buildStepOkB")],
		});
		assert.equal(now.isError, false);
		assert.equal(
			(await b.waitJob(String(now.out["jobId"]))).out["status"],
			"done",
		);
	});
});
