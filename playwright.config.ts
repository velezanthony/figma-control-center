// E2E de navegador con Playwright y SU Chromium (nunca el Chrome del usuario): `make e2e-setup` lo descarga.
// Comprueban comportamiento (flujos, foco, scroll, accesibilidad), no aspecto: un solo proyecto, escritorio claro.
import { defineConfig, devices } from "@playwright/test";

export const BROWSER_TESTS_DIR = "server/test/e2e/browser";
const OUTPUT_DIR = "output/e2e";
const DESKTOP = { width: 1280, height: 800 } as const;
const TIMEOUT_MS = 60_000;
const EXPECT_TIMEOUT_MS = 10_000;

const project = (
	name: string,
	theme: "light" | "dark",
	viewport: { width: number; height: number },
) => ({
	name,
	// Solo el Chromium de Playwright: sin `channel` ni `executablePath`
	use: { ...devices["Desktop Chrome"], viewport, colorScheme: theme, theme },
});

export default defineConfig({
	testDir: BROWSER_TESTS_DIR,
	outputDir: `${OUTPUT_DIR}/results`,
	timeout: TIMEOUT_MS,
	fullyParallel: true,
	workers: 4,
	forbidOnly: true,
	retries: 0,
	reporter: [
		["list"],
		["html", { outputFolder: `${OUTPUT_DIR}/report`, open: "never" }],
	],
	expect: { timeout: EXPECT_TIMEOUT_MS },
	use: {
		// Trazas al fallar: capturas, DOM y red, en output/e2e/results
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		locale: "es-ES",
		timezoneId: "Europe/Madrid",
	},
	projects: [project("light-desktop", "light", DESKTOP)],
});
