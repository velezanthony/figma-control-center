// E54 visto en el panel: la lectura sale en Actividad como cualquier llamada, con la ruta del JSON en «Resultado en
// disco» y su job; las exportaciones de E56 no entran en Capturas

import { TOOL_NAME } from "#domain/tool-names.ts";
import { expect, test } from "./fixtures.ts";

test("E54 · figma_variables sale en Actividad con la ruta de su fichero y su job", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const r = await claude.callTool(TOOL_NAME.variables, {
		collection: "Tokens",
	});
	const path = String(r.out["path"]);
	await page.goto(`${env.dashboardUrl}/#/activity`);
	const row = page.getByRole("row").filter({ hasText: "figma_variables" });
	await row.getByRole("button", { name: "Ver detalle" }).click();
	await expect(page.getByText("Resultado en disco")).toBeVisible();
	await expect(page.getByText(path, { exact: true })).toBeVisible();
	await expect(page.getByText("Job terminado").first()).toBeVisible();
});

test("E56 · una exportación no aparece en Capturas", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	await claude.callTool(TOOL_NAME.export, { nodeIds: ["10:1"], format: "PNG" });
	await claude.callTool(TOOL_NAME.screenshot, { nodeId: "10:3", scale: 1 });
	await page.goto(`${env.dashboardUrl}/#/captures`);
	await expect(
		page.getByRole("img", { name: "Captura del nodo 10:3" }),
	).toBeVisible();
	await expect(
		page.getByRole("img", { name: "Captura del nodo 10:1" }),
	).toHaveCount(0);
});
