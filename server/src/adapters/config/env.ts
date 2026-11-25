// Único módulo que lee process.env: carga .env (si existe) y construye la configuración en capas.
// Ningún otro módulo toca process.env: todos reciben `config`.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	describeSettings,
	parseConfig,
	parseLayered,
	REPO_ROOT,
	setByEnvironment,
	settingProblems,
} from "./schema.ts";

const ENV_FILE = resolve(REPO_ROOT, ".env");

// El entorno con el que arrancó el proceso, ANTES de cargar el .env: lo único de lo que agent-run.ts saca la lista blanca
// del entorno de `claude` (nada del .env)
export const launchEnvironment: Readonly<Record<string, string | undefined>> =
	Object.freeze({ ...process.env });

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

// Config en capas de ARRANQUE (solo defaults + entorno): dice dónde está la base. La final, con los ajustes guardados en
// ella (default < base < entorno), la compone compose-settings.ts con `layeredWith`.
export const bootLayered = parseLayered(process.env, ENV_FILE);
export const layeredWith = (stored: Readonly<Record<string, string>>) =>
	parseLayered(process.env, ENV_FILE, stored);
// Los ajustes editables con lo guardado, lo efectivo y su origen (para el panel), con qué valor arrancó quien pregunta
// (`storedAtBoot`), y los guardados que no valen
export const describeStored = (
	stored: Readonly<Record<string, string>>,
	storedAtBoot: Readonly<Record<string, string>>,
) => describeSettings(process.env, stored, storedAtBoot);
export const problemsOfStored = (stored: Readonly<Record<string, string>>) =>
	settingProblems(stored);
// Si el entorno del panel (con el .env ya cargado) fija una clave: entonces manda sobre lo guardado y no se guarda
export const setByPanelEnvironment = (key: string) =>
	setByEnvironment(process.env, key);
// Config plana de un solo archivo de Figma: solo la sonda de spikes/m0/cdp-probe.ts. Exige FIGMA_FILE_URL, así que se
// construye al pedirla: importar este módulo sin esa variable (el servidor MCP, el panel) no puede fallar por ella
export const flatConfig = () =>
	parseConfig(process.env, ENV_FILE, {
		exists: existsSync,
		warn: (message: string) => console.error(message),
	});
export type { Config, LayeredConfig } from "./schema.ts";
