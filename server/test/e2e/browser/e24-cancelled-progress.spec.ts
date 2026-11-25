// E24 un lote de 4 pasos cancelado durante el 3.º se ve 3/4 en Jobs, con la barra sin rojo (cancelar no es fallar).
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;

type StepKey =
	| "buildStepOkA"
	| "buildStepOkB"
	| "buildStepOkC"
	| "buildStepSlow";
const step = (key: StepKey) => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

test("E24 · un lote cancelado en el 3.º enseña 3/4 y la barra no es roja", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [
			step("buildStepOkA"),
			step("buildStepOkB"),
			step("buildStepSlow"),
			step("buildStepOkC"),
		],
	});
	const jobId = String(started.out["jobId"]);

	await until(
		"el 3.º paso está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);
	await claude.callTool(TOOL_NAME.cancelJob, { jobId });
	await releaseGate(env.simulator, SLOW_GATE);
	await claude.waitJob(jobId);

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	const row = page.getByRole("row").filter({ hasText: /\d+ pasos?/ });
	await expect(row).toContainText("Job cancelado");
	await row.getByRole("button", { name: "Ver detalle" }).click();

	const bar = page.getByRole("progressbar", { name: "Progreso del lote" });
	await expect(bar).toHaveAttribute("aria-valuenow", "3");
	await expect(bar).toHaveAttribute("aria-valuemax", "4");
	await expect(bar.locator("div")).not.toHaveClass(/bg-danger-500/);
});
