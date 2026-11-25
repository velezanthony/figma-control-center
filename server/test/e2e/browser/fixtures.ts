// Fixtures de Playwright: un entorno completo (procesos reales + simulador de Figma) por prueba y el tema del proyecto
import { test as base } from "@playwright/test";
import { DASHBOARD_MODE } from "#domain/settings.ts";
import {
	type Environment,
	type EnvironmentOptions,
	startEnvironment,
} from "../../harness/environment.ts";
import { THEME_STORAGE_KEY } from "./theme-key.ts";

type Theme = "light" | "dark";

export type WorkerFixtures = {
	// Panel sin Figma ni sesiones, en modo desarrollo: sirve la galería de componentes (estática) a todas las pruebas del worker
	galleryUrl: string;
};

export type Fixtures = {
	theme: Theme;
	// Arranca un entorno propio (se destruye al terminar la prueba, pase o falle)
	makeEnv: (options?: EnvironmentOptions) => Promise<Environment>;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
	galleryUrl: [
		// biome-ignore lint/correctness/noEmptyPattern: Playwright exige desestructurar el primer argumento aunque no use fixtures
		async ({}, use) => {
			const env = await startEnvironment({
				figma: "down",
				extraEnv: { FCC_DASHBOARD_MODE: DASHBOARD_MODE.development },
			});
			await use(env.dashboardUrl);
			await env.stop();
		},
		{ scope: "worker" },
	],
	theme: ["light", { option: true }],
	// biome-ignore lint/correctness/noEmptyPattern: Playwright exige desestructurar el primer argumento aunque no use fixtures
	makeEnv: async ({}, use) => {
		const started: Environment[] = [];
		await use(async (options) => {
			const env = await startEnvironment(options);
			started.push(env);
			return env;
		});
		const failures: unknown[] = [];
		for (const env of started) {
			await env.stop().catch((e: unknown) => failures.push(e));
		}
		if (failures.length > 0) throw failures[0];
	},
	page: async ({ page, theme }, use) => {
		// El tema se guarda en localStorage y se aplica antes del primer pintado
		await page.addInitScript(
			([key, value]) => {
				try {
					localStorage.setItem(key as string, value as string);
				} catch {
					// sin almacenamiento
				}
			},
			[THEME_STORAGE_KEY, theme],
		);
		await use(page);
	},
});

export { expect } from "@playwright/test";
