// E14 la barra de progreso del lote avanza en vivo en Jobs · E15 un lote cancelado se ve como tal en el panel.
// (E16 y E17 no piden aserciones de panel en el panel: su comprobación vive en el E2E de servidor.)
// Los pasos son escenarios herméticos (// @scenario: build-step-*); sin Figma ni Chrome.
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;

type StepKey = "buildStepOkA" | "buildStepOkB" | "buildStepSlow";
const step = (key: StepKey) => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

test("E14 · la barra de progreso del lote avanza en vivo en Jobs", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepSlow"), step("buildStepOkB")],
	});
	expect(started.out["status"]).toBe("running");

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	const row = page.getByRole("row").filter({ hasText: /\d+ pasos?/ });
	await expect(row).toContainText("Job en curso");
	await row.getByRole("button", { name: "Ver detalle" }).click();

	// Con el paso lento en curso, solo el primero ha terminado: la barra marca 1
	const bar = page.getByRole("progressbar", { name: "Progreso del lote" });
	await expect(bar).toHaveAttribute("aria-valuenow", "1");
	await expect(bar).toHaveAttribute("aria-valuemax", "3");

	// Sin recargar: al soltar el paso lento, los pasos restantes terminan y la barra avanza en vivo a 3
	await releaseGate(env.simulator, SLOW_GATE);
	await expect(bar).toHaveAttribute("aria-valuenow", "3");
	await expect(row).toContainText("Job terminado");
});

test("E15 · un lote cancelado a mitad se ve «cancelado» en el panel", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepSlow"), step("buildStepOkB")],
	});
	const jobId = String(started.out["jobId"]);

	await until(
		"el paso lento está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);
	await claude.callTool(TOOL_NAME.cancelJob, { jobId });
	await releaseGate(env.simulator, SLOW_GATE);
	await claude.waitJob(jobId);

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	const row = page.getByRole("row").filter({ hasText: /\d+ pasos?/ });
	await expect(row).toContainText("Job cancelado");
	await row.getByRole("button", { name: "Ver detalle" }).click();
	// La insignia «Cancelado» del lote y los pasos que sí corrieron
	await expect(
		page.getByText("Cancelado", { exact: true }).first(),
	).toBeVisible();
	await expect(page.getByText("Pasos del lote")).toBeVisible();
});
