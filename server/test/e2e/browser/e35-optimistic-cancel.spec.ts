// E35 «Cancelar» se actualiza al pulsar, sin esperar a la red, y se reconcilia con el servidor: si la petición falla,
// el botón vuelve a poder pulsarse y dice por qué.
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;
const CANCEL_URL = /\/api\/jobs\/cancel(\?|$)/;
const step = (key: "buildStepOkA" | "buildStepSlow") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

async function openRunningBatch(
	env: Awaited<
		ReturnType<Parameters<Parameters<typeof test>[2]>[0]["makeEnv"]>
	>,
	page: import("@playwright/test").Page,
) {
	const claude = await env.startClaude({ reply: null });
	await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepSlow")],
	});
	await until(
		"el paso lento está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);
	await page.goto(`${env.dashboardUrl}/#/jobs`);
	await page
		.getByRole("row")
		.filter({ hasText: /2 pasos/ })
		.getByRole("button", { name: "Ver detalle" })
		.click();
}

test("E35 · al pulsar, el texto pasa a «Ya se pidió cancelar» sin esperar a la respuesta", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	await openRunningBatch(env, page);
	const cancel = page.getByRole("button", { name: "Cancelar" });
	await expect(cancel).toBeEnabled();

	// La petición de cancelar tarda: lo que se ve no puede depender de ella
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(CANCEL_URL, async (route) => {
		if (route.request().method() === "POST") await held;
		await route.continue();
	});
	await cancel.click();
	await expect(cancel).toBeDisabled();
	await expect(cancel).toHaveAccessibleDescription(/Ya se pidió cancelar/, {
		timeout: 1000,
	});
	release();
	await expect(cancel).toHaveAccessibleDescription(/Ya se pidió cancelar/);
	await releaseGate(env.simulator, SLOW_GATE);
});

test("E35 · si el servidor rechaza la petición, vuelve a poder pulsarse y cuenta el motivo", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	await openRunningBatch(env, page);
	const cancel = page.getByRole("button", { name: "Cancelar" });
	await expect(cancel).toBeEnabled();
	await page.route(CANCEL_URL, async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({
				ok: false,
				error: {
					type: "Boom",
					message: "No se pudo pedir la cancelación de prueba.",
				},
			}),
		});
	});
	await cancel.click();
	await expect(page.getByRole("alert")).toContainText("cancelación de prueba");
	await expect(cancel).toBeEnabled();
	await expect(cancel).toHaveAccessibleDescription(/Pide a la sesión/);
	await releaseGate(env.simulator, SLOW_GATE);
});
