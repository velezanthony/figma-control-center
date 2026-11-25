// E45 Jobs enseña el extracto del resultado de cada paso y, bajo demanda, el resultado entero.
// Los pasos son escenarios herméticos; sin Figma ni Chrome.
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { expect, test } from "./fixtures.ts";

const step = (key: "buildStepMediumResult" | "buildStepOkA") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

test("E45 · el detalle del lote enseña un extracto y «Ver completo» pide el resto", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepMediumResult"), step("buildStepOkA")],
	});
	await claude.waitJob(String(started.out["jobId"]));

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	await page
		.getByRole("row")
		.filter({ hasText: /2 pasos/ })
		.getByRole("button", { name: "Ver detalle" })
		.click();

	await expect(
		page.getByText(/Recortado: el resultado entero ocupa \d+ bytes/),
	).toBeVisible();
	await expect(page.getByText("enlace 100")).toHaveCount(0);
	await page.getByRole("button", { name: "Ver completo" }).click();
	await expect(page.getByText("enlace 100").first()).toBeVisible();
	await expect(page.getByRole("button", { name: "Ver completo" })).toHaveCount(
		0,
	);
	// El paso corto no tiene nada que pedir
	await expect(page.getByText("createdNodeIds").first()).toBeVisible();
});
