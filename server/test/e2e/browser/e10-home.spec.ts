// E10 · la página de inicio dice el estado real de cada pieza y su siguiente paso cuando algo no está listo
import { TOOL_NAME } from "#domain/tool-names.ts";
import type { FigmaState } from "../../harness/environment.ts";
import { expect, test } from "./fixtures.ts";

type Expected = { chrome: RegExp; figma: RegExp; next: string[] };

const CASES: ReadonlyArray<readonly [FigmaState, Expected]> = [
	[
		"down",
		{
			chrome: /Chrome no responde/,
			figma: /Figma sin comprobar/,
			next: [
				"Arranca Chrome con el puerto de depuración.",
				"Primero hace falta Chrome.",
			],
		},
	],
	[
		"wrongTab",
		{
			chrome: /Chrome responde/,
			figma: /Sin pestaña de Figma/,
			next: [
				"Abre la URL del archivo del proyecto (la de la página «Proyectos») en el Chrome de depuración.",
			],
		},
	],
	[
		"notReady",
		{ chrome: /Chrome responde/, figma: /Figma no está listo/, next: [] },
	],
	["up", { chrome: /Chrome responde/, figma: /Figma listo/, next: [] }],
];

for (const [state, expected] of CASES) {
	test(`E10 · inicio con el simulador «${state}»`, async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: state });
		const claude = await env.startClaude({ reply: null });
		await claude.callTool(TOOL_NAME.status);
		await page.goto(`${env.dashboardUrl}/#/`);

		// Las píldoras y, debajo, el siguiente paso de lo que no está listo: la tarjeta «Estado ahora» entera
		const status = page
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "Estado ahora" }) });
		await expect(
			status.getByRole("list", { name: "Estado ahora" }),
		).toContainText("Panel conectado");
		await expect(status).toContainText(expected.chrome);
		await expect(status).toContainText(expected.figma);
		for (const step of expected.next) await expect(status).toContainText(step);
		if (state === "up")
			await expect(status).toContainText("Archivo de ejemplo · Inicio");
	});
}
