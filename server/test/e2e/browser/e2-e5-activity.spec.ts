// E2 escritura con nodos · E3 script largo en vivo · E4 captura · E5 coherencia, vistos en el panel

import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const run = (scenario: keyof typeof SCENARIOS) => {
	const s = SCENARIOS[scenario];
	return { file: scenarioPath(s.script), format: s.format };
};
// El job de «script largo» tiene que poder seguir vivo más allá del plazo de las demás llamadas
const LONG_CALL_TIMEOUT_MS = "60000";
const FIGMA_FILE = "https://www.figma.com/design/SIMULADO/Archivo";

test("E2 · una escritura muestra sus nodos y los enlaza al archivo de Figma", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	await claude.callTool(TOOL_NAME.runScript, run("writeCreated"));
	await page.goto(`${env.dashboardUrl}/#/activity`);
	const row = page.getByRole("row").filter({ hasText: "write-created.js" });
	await expect(row.getByRole("cell", { name: "3", exact: true })).toBeVisible();
	await row.getByRole("button", { name: "Ver detalle" }).click();
	for (const [id, param] of [
		["10:1", "10-1"],
		["10:2", "10-2"],
		["10:3", "10-3"],
	] as const) {
		const link = page.getByRole("link", { name: id, exact: true }).first();
		await expect(link).toHaveAttribute(
			"href",
			`${FIGMA_FILE}?node-id=${param}`,
		);
	}
});

test("E3 · un script largo pasa de «en curso» a «terminado» en vivo", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({
		extraEnv: { FIGMA_CDP_CALL_TIMEOUT_MS: LONG_CALL_TIMEOUT_MS },
	});
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(
		TOOL_NAME.runScript,
		run("longRunning"),
	);
	expect(started.out["status"]).toBe("running");

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	const row = page.getByRole("row").filter({ hasText: "long-running.js" });
	await expect(row).toContainText("Job en curso");

	// Sin recargar: al terminar Figma, la misma fila pasa a «Job terminado»
	await releaseGate(env.simulator, SCENARIOS.longRunning.reply.gate);
	await expect(row).toContainText("Job terminado");
	await expect(row).not.toContainText("Job en curso");
});

test("E4 · una captura aparece como miniatura en Actividad y en Capturas", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	await claude.callTool(TOOL_NAME.screenshot, { nodeId: "10:1", scale: 1 });

	await page.goto(`${env.dashboardUrl}/#/captures`);
	const thumb = page.getByRole("img", { name: "Captura del nodo 10:1" });
	await expect(thumb).toBeVisible();
	await expect
		.poll(() =>
			thumb.evaluate(
				(img) => (img as unknown as { naturalWidth: number }).naturalWidth,
			),
		)
		.toBe(120);

	await page.goto(`${env.dashboardUrl}/#/activity`);
	await page
		.getByRole("row")
		.filter({ hasText: "figma_screenshot" })
		.getByRole("button", { name: "Ver detalle" })
		.click();
	await expect(
		page.getByRole("img", { name: "Captura del nodo 10:1" }),
	).toBeVisible();
});

test("E5 · el panel, la API y la herramienta MCP cuentan lo mismo", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	await claude.callTool(TOOL_NAME.runScript, run("writeCreated"));
	await claude.callTool(TOOL_NAME.runScript, run("readValue"));
	await claude.callTool(TOOL_NAME.runScript, run("errorRuntime"));
	const summary = (await claude.callTool(TOOL_NAME.historySummary)).out[
		"summary"
	] as {
		calls: number;
		errors: number;
		nodesTouched: number;
	};

	await page.goto(`${env.dashboardUrl}/#/activity`);
	await expect(
		page.getByText(`${summary.calls} llamadas en el histórico`),
	).toBeVisible();
	const main = page.getByRole("main");
	await expect(main).toContainText(
		new RegExp(`Errores[^\\d]*${summary.errors}\\b`),
	);
	await expect(main).toContainText(
		new RegExp(`Nodos tocados[^\\d]*${summary.nodesTouched}\\b`),
	);
	await expect(page.getByRole("row")).toHaveCount(summary.calls + 1);
});
