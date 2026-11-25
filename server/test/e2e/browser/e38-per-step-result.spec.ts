// E38 Jobs enseña el resultado de cada paso del lote: el JSON si cupo, la ruta si fue a fichero, y que no hay
// resultado guardado en un paso omitido. Los pasos son escenarios herméticos; sin Figma ni Chrome.
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { expect, test } from "./fixtures.ts";

const step = (key: "buildStepOkA" | "buildStepBigResult" | "buildStepOkB") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

test("E38 · el detalle del lote enseña el resultado de cada paso", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [
			step("buildStepOkA"),
			step("buildStepBigResult"),
			step("buildStepOkB"),
		],
		fromStep: 0,
	});
	await claude.waitJob(String(started.out["jobId"]));
	const resumed = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepOkB")],
		fromStep: 1,
	});
	await claude.waitJob(String(resumed.out["jobId"]));

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	const rows = page.getByRole("row").filter({ hasText: /\d+ pasos?/ });
	await rows
		.filter({ hasText: /3 pasos/ })
		.getByRole("button", { name: "Ver detalle" })
		.click();

	await expect(page.getByText("createdNodeIds").first()).toBeVisible();
	await expect(
		page.getByText(/Resultado en disco \(\d+ bytes\)/),
	).toBeVisible();
	await expect(page.getByText(/result-.*\.json/).first()).toBeVisible();

	await rows
		.filter({ hasText: /2 pasos/ })
		.getByRole("button", { name: "Ver detalle" })
		.click();
	await expect(page.getByText("Sin resultado guardado").first()).toBeVisible();
});
