// E51 en el navegador: «Cerrar agente». Sin agente, desactivado con su motivo; con un lote en
// curso, pregunta; al confirmar, el panel manda `close` por la vigilancia y es agent-run.ts quien cierra a claude (el
// panel no manda ninguna señal: lo vigila server/test/architecture.test.ts). Nada pasa por el canal (CA-5).
import { copyFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { agentProjectDirs } from "../../harness/env.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const LAUNCH_CHAIN_TIMEOUT_MS = 40_000;
const NO_TRAFFIC = { channelMessages: 0, toolCalls: ["figma_status"] };
// Mismo margen con el borde de la ventana que el resto de flotantes del panel (EDGE de web/src/lib/ui/floating.ts)
const VIEWPORT_EDGE_PX = 8;
const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;
const ACTIVE_SESSION = /^Sesión de las \d\d:\d\d · activa$/;

// Los scripts tienen que estar en las raíces del proyecto del agente (el arnés rechaza los del repo): se copian ahí
const step = (dir: string, key: "buildStepOkA" | "buildStepSlow") => {
	const source = scenarioPath(SCENARIOS[key].script);
	const file = join(agentProjectDirs(dir).scriptsRoot, basename(source));
	copyFileSync(source, file);
	return { file, format: SCENARIOS[key].format };
};

test("E51 · sin agente lanzado desde el panel, «Cerrar agente» está desactivado y dice por qué", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	await page.goto(`${env.dashboardUrl}/#/chat`);
	const button = page.getByRole("button", { name: "Cerrar agente" });
	await expect(button).toBeDisabled();
	await button.hover({ force: true });
	const tooltip = page.getByText("No hay ningún agente abierto desde el panel");
	await expect(tooltip).toBeVisible();
	// El botón está arriba a la derecha: el tooltip guarda el margen con el borde de la ventana, como los demás
	const viewport = page.viewportSize();
	await expect(async () => {
		const box = await tooltip.boundingBox();
		expect(box).not.toBeNull();
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
			(viewport?.width ?? 0) - VIEWPORT_EDGE_PX,
		);
	}).toPass();
});

test("E51 · con un lote en curso pide confirmación y, al confirmar, el agente se cierra por su vigilancia", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({
		agentProject: true,
		extraEnv: {
			FCC_AGENT_LAUNCH_TIMEOUT_MS: String(LAUNCH_CHAIN_TIMEOUT_MS),
		},
	});
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await page.getByRole("button", { name: "Lanzar agente" }).click();
	await until(
		"la sesión simulada conecta",
		() => env.fakeClaude.traffic() !== null,
		LAUNCH_CHAIN_TIMEOUT_MS,
	);
	const button = page.getByRole("button", { name: "Cerrar agente" });
	await expect(button).toBeEnabled({ timeout: LAUNCH_CHAIN_TIMEOUT_MS });
	await expect(page.getByText(ACTIVE_SESSION)).toBeVisible();
	// Un lote de verdad, de otra sesión del proyecto, que empieza con la página ya abierta: figma_build responde al
	// momento (su llamada queda en `ok`) y lo que sigue en curso es su job
	// El panel se entera por la conexión en vivo, sin recargar (con su pequeña espera para agrupar eventos)
	const panelSeesBatch = page.waitForResponse(
		async (r) =>
			r.url().includes("/api/history/calls?") &&
			((await r.json()) as { total?: number }).total === 1,
	);
	const batcher = await env.startClaude({ reply: null });
	await batcher.callTool(TOOL_NAME.build, {
		steps: [step(env.dir, "buildStepOkA"), step(env.dir, "buildStepSlow")],
	});
	await until(
		"el paso lento del lote está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);
	expect(
		env.rows<{ status: string; job: string }>(
			"SELECT c.status, j.status AS job FROM calls c JOIN jobs j ON j.call_id = c.call_id WHERE c.tool = 'figma_build'",
		),
	).toEqual([{ status: "ok", job: "running" }]);
	await panelSeesBatch;

	await button.click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByText(
			"Hay un lote en curso: si cierras el agente, el lote queda interrumpido. ¿Cerrar igualmente?",
		),
	).toBeVisible();
	// Cancelar no cierra nada
	await dialog.getByRole("button", { name: "Cancelar" }).click();
	await expect(dialog).toBeHidden();
	expect(env.fakeClaude.signals()).toEqual([]);

	await button.click();
	await page.getByRole("button", { name: "Cerrar igualmente" }).click();
	await until(
		"claude recibe el cierre de agent-run.ts",
		() => env.fakeClaude.signals().length > 0,
	);
	expect(env.fakeClaude.signals()).toEqual(["SIGTERM"]);
	await until("la carpeta del lanzamiento desaparece", () =>
		readdirSync(join(env.dir, "tmp")).every(
			(n) => !n.startsWith("figma-agent-"),
		),
	);
	await expect(button).toBeDisabled({ timeout: LAUNCH_CHAIN_TIMEOUT_MS });
	expect(env.fakeClaude.traffic()).toEqual(NO_TRAFFIC);
	await releaseGate(env.simulator, SLOW_GATE);
});

test("E51 · al cerrar el agente con el botón, su sesión deja de salir como activa sin recargar", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({
		agentProject: true,
		extraEnv: {
			FCC_AGENT_LAUNCH_TIMEOUT_MS: String(LAUNCH_CHAIN_TIMEOUT_MS),
		},
	});
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await page.getByRole("button", { name: "Lanzar agente" }).click();
	const active = page.getByText(ACTIVE_SESSION);
	await expect(active).toBeVisible({ timeout: LAUNCH_CHAIN_TIMEOUT_MS });
	const button = page.getByRole("button", { name: "Cerrar agente" });
	await expect(button).toBeEnabled({ timeout: LAUNCH_CHAIN_TIMEOUT_MS });

	await button.click();
	await expect(button).toBeDisabled({ timeout: LAUNCH_CHAIN_TIMEOUT_MS });
	await expect(active).toBeHidden({ timeout: LAUNCH_CHAIN_TIMEOUT_MS });
});
