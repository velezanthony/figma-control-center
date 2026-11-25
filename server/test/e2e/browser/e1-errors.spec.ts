// E1 en el navegador: cada tipo de error del dominio llega al panel con su badge, su tooltip y su siguiente paso.

import { join } from "node:path";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	ERROR_SCENARIOS,
	type ErrorScenario,
} from "../../fixtures/scenarios/errors.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import type { Environment } from "../../harness/environment.ts";
import { markerLine, scenarioPath } from "../../harness/script-files.ts";
import { expect, test } from "./fixtures.ts";

const SHORT_CALL_TIMEOUT_MS = 150;

const figmaFor = (setup: ErrorScenario["setup"]) =>
	setup.kind === "chromeDown"
		? "down"
		: setup.kind === "wrongTab"
			? "wrongTab"
			: setup.kind === "figmaNotLoaded"
				? "notReady"
				: "up";

const argsFor = (env: Environment, setup: ErrorScenario["setup"]) => {
	if (setup.kind === "pathOutsideRoots")
		return { file: join(env.dir, "fuera.js") };
	if (setup.kind === "script") {
		const scenario = SCENARIOS[setup.scenario];
		return {
			file: scenarioPath(scenario.script),
			format: scenario.format,
			...(setup.scenario === "errorTimeout"
				? { timeoutMs: SHORT_CALL_TIMEOUT_MS }
				: {}),
		};
	}
	if (setup.kind === "nodeMissing") return { nodeId: "99:99" };
	return { code: "return 1;" };
};

const toolFor = (setup: ErrorScenario["setup"]) =>
	setup.kind === "nodeMissing" ? TOOL_NAME.screenshot : TOOL_NAME.runScript;

for (const scenario of ERROR_SCENARIOS) {
	test(`E1 · ${scenario.id}: badge ${scenario.type}, tooltip y siguiente paso`, async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: figmaFor(scenario.setup) });
		const claude = await env.startClaude({ reply: null });
		await claude.callTool(
			toolFor(scenario.setup),
			argsFor(env, scenario.setup),
		);

		await page.goto(`${env.dashboardUrl}/#/activity`);
		const row = page.getByRole("row").filter({ hasText: scenario.type });
		await expect(row).toHaveCount(1);

		// El badge dice el tipo y su tooltip lo explica (con ratón y con foco: es el mismo disparador)
		const badge = row.getByText(scenario.type, { exact: true });
		await badge.hover();
		await expect(
			page.getByRole("tooltip").filter({ hasText: /\S/ }),
		).toBeVisible();

		// El detalle desplegado (role=alert) trae el siguiente paso, la línea si es un error de script y si es reintentable
		await row.getByRole("button", { name: "Ver detalle" }).click();
		const alert = page.getByRole("alert");
		await expect(
			alert.locator("p", { hasText: "Siguiente paso:" }),
		).toContainText(scenario.nextStep);
		if (scenario.type === "ScriptError") {
			const line = markerLine(
				SCENARIOS[
					scenario.setup.kind === "script"
						? scenario.setup.scenario
						: "errorRuntime"
				].script,
				scenario.setup.kind === "script"
					? (scenario.setup.lineMarker ?? "")
					: "",
			);
			await expect(
				alert.getByText(`línea ${line}`, { exact: true }),
			).toBeVisible();
		}
		await expect(alert.getByText("reintentable", { exact: true })).toHaveCount(
			scenario.retryable ? 1 : 0,
		);
	});
}
