// El Chrome de captura de las pruebas: el Chromium de Playwright (nunca el Chrome del usuario). Como hace el propio
// Playwright, sin el sandbox de Chromium, que en Ubuntu 23.10+ no arranca sin namespaces de usuario; por eso va en un
// envoltorio de las pruebas (FCC_WEB_CHROME_BIN) y el adaptador de producción no lleva ese flag.
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

export const PLAYWRIGHT_CHROMIUM = chromium.executablePath();

export async function captureChromeBin(dir: string): Promise<string> {
	const bin = join(dir, "chromium-de-pruebas.sh");
	await writeFile(
		bin,
		`#!/bin/sh\nexec '${PLAYWRIGHT_CHROMIUM}' --no-sandbox "$@"\n`,
	);
	await chmod(bin, 0o755);
	return bin;
}
