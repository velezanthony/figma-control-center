// E30 cancelar un lote desde Jobs: el panel deja la petición en SQLite y la sesión dueña (el Claude simulado) la ejecuta.
// Deshabilitado, con el motivo como tooltip y como descripción accesible, cuando no se puede.
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

// El plazo de la llamada del arnés (600 ms) cerraría el job como fallido antes de mirarlo
const LONG_SCRIPT_TIMEOUT_MS = 60_000;
const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;

type StepKey = "buildStepOkA" | "buildStepOkB" | "buildStepSlow";
const step = (key: StepKey) => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

test("E30 · «Cancelar» en un lote en marcha lo para y el lote acaba cancelado con su progreso real", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepSlow"), step("buildStepOkB")],
	});
	await until(
		"el paso lento está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	const row = page.getByRole("row").filter({ hasText: /3 pasos/ });
	await row.getByRole("button", { name: "Ver detalle" }).click();
	const cancel = page.getByRole("button", { name: "Cancelar" });
	await expect(cancel).toBeEnabled();
	await cancel.click();

	// La petición queda dicha y el botón pasa a explicar por qué ya no se puede pulsar
	await expect(cancel).toBeDisabled();
	await expect(cancel).toHaveAccessibleDescription(/Ya se pidió cancelar/);
	await until(
		"la sesión recogió la petición",
		() =>
			env.rows("SELECT 1 FROM cancel_requests WHERE status = 'done'").length ===
			1,
	);

	await releaseGate(env.simulator, SLOW_GATE);
	await expect(row).toContainText("Job cancelado");
	const bar = page.getByRole("progressbar", { name: "Progreso del lote" });
	await expect(bar).toHaveAttribute("aria-valuenow", "2");
	await expect(bar).toHaveAttribute("aria-valuemax", "3");
});

test("E30 · un lote terminado no se puede cancelar y el botón dice por qué", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA")],
	});
	await claude.waitJob(String(started.out["jobId"]));

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	await page
		.getByRole("row")
		.filter({ hasText: /1 paso/ })
		.getByRole("button", { name: "Ver detalle" })
		.click();
	const cancel = page.getByRole("button", { name: "Cancelar" });
	await expect(cancel).toBeDisabled();
	await expect(cancel).toHaveAccessibleDescription(/ya terminó/);
	// Con el ratón, el mismo motivo sale como tooltip (el botón deshabilitado no recibe el puntero: lo recoge su envoltorio)
	await cancel.locator("..").hover();
	await expect(page.getByRole("tooltip")).toContainText(/ya terminó/);
});

test("E30 · un figma_run_script suelto no se cancela: solo los lotes", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.runScript, {
		file: scenarioPath(SCENARIOS.longRunning.script),
		format: SCENARIOS.longRunning.format,
		timeoutMs: LONG_SCRIPT_TIMEOUT_MS,
	});
	expect(started.out["status"]).toBe("running");

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	await page
		.getByRole("row")
		.filter({ hasText: SCENARIOS.longRunning.script })
		.getByRole("button", { name: "Ver detalle" })
		.click();
	const cancel = page.getByRole("button", { name: "Cancelar" });
	await expect(cancel).toBeDisabled();
	await expect(cancel).toHaveAccessibleDescription(/Solo se cancelan lotes/);
	await releaseGate(env.simulator, SCENARIOS.longRunning.reply.gate);
});

test("E30 · con la sesión dueña muerta el botón dice que nadie puede ejecutar la cancelación", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepSlow")],
	});
	await until(
		"el paso lento está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);
	const pid = claude.pid;
	if (pid === null) throw new Error("la sesión simulada no tiene pid");
	process.kill(pid, "SIGKILL");
	await until("la sesión murió", () => {
		try {
			process.kill(pid, 0);
			return false;
		} catch {
			return true;
		}
	});

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	await page
		.getByRole("row")
		.filter({ hasText: /2 pasos/ })
		.getByRole("button", { name: "Ver detalle" })
		.click();
	const cancel = page.getByRole("button", { name: "Cancelar" });
	await expect(cancel).toBeDisabled();
	await expect(cancel).toHaveAccessibleDescription(
		/sesión .* ya no está activa/,
	);
});
