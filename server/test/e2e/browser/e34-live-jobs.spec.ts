// E34 un lote nuevo aparece en Jobs en vivo, sin recargar, como el resto de eventos.
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;
const step = (key: "buildStepOkA" | "buildStepSlow") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

test("E34 · Jobs abierto: un lote nuevo aparece sin recargar", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	await page.goto(`${env.dashboardUrl}/#/jobs`);
	// El SSE ya está abierto: lo dice el detalle del pie de la barra (en su tooltip, presente aunque no se vea)
	await expect(page.getByText("Panel conectado").first()).toBeAttached();
	const claude = await env.startClaude({ reply: null });
	const first = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA")],
	});
	await claude.waitJob(String(first.out["jobId"]));
	await expect(
		page.getByRole("row").filter({ hasText: /1 paso/ }),
	).toBeVisible();

	await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepSlow")],
	});
	await until(
		"el paso lento está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);
	await expect(
		page.getByRole("row").filter({ hasText: /2 pasos/ }),
	).toBeVisible();
	await releaseGate(env.simulator, SLOW_GATE);
});

test("E34 · con un goteo continuo de eventos la lista tampoco se queda sin refrescar", async ({
	page,
	makeEnv,
}) => {
	test.setTimeout(60_000);
	const env = await makeEnv();
	await page.goto(`${env.dashboardUrl}/#/jobs`);
	// El SSE ya está abierto: lo dice el detalle del pie de la barra (en su tooltip, presente aunque no se vea)
	await expect(page.getByText("Panel conectado").first()).toBeAttached();
	const claude = await env.startClaude({ reply: null });
	const noisy = await env.startClaude({ reply: null });
	let drip = true;
	const dripping = (async () => {
		while (drip) {
			await noisy.callTool(TOOL_NAME.status, {});
			await new Promise((r) => setTimeout(r, 60));
		}
	})();
	try {
		await claude.callTool(TOOL_NAME.build, {
			steps: [step("buildStepOkA"), step("buildStepSlow")],
		});
		await until(
			"el paso lento está en curso",
			() => env.simulator?.waiting(SLOW_GATE) === 1,
		);
		await expect(
			page.getByRole("row").filter({ hasText: /2 pasos/ }),
		).toBeVisible({ timeout: 5000 });
	} finally {
		drip = false;
		await dripping;
		await releaseGate(env.simulator, SLOW_GATE);
	}
});
