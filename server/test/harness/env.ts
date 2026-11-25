// Configuración COMPLETA y explícita de los procesos de prueba: ninguno depende de un .env. Los valores de
// tiempo y de puerto son constantes con nombre (nada de números sueltos en los tests).
import { join } from "node:path";
import type { EntryDraft } from "#domain/registry.ts";
import { DASHBOARD_MODE } from "#domain/settings.ts";

export const LOOPBACK = "127.0.0.1";

export const TIMING = Object.freeze({
	// Sondeo del panel y de la sesión: corto para que los tests no esperen
	pollMs: 25,
	// Plazo blando de figma_run_script: pasado, el script sigue como job
	softDeadlineMs: 400,
	// Plazo de una llamada CDP (el escenario «timeout» no responde nunca)
	callTimeoutMs: 600,
	readyTimeoutMs: 300,
	launchTimeoutMs: 4000,
	// Cuánto espera un test a que ocurra algo antes de darlo por perdido
	waitMs: 10_000,
} as const);

export type EnvOptions = {
	readonly dir: string;
	readonly cdpPort: number;
	readonly scriptsRoot: string;
	readonly dashboardPort: number;
	// La orden del lanzador del agente (se parte por espacios, sin shell)
	readonly agentTerminal: string;
	readonly extra?: Readonly<Record<string, string>>;
};

// La base única de la máquina (FCC_DB) del entorno de prueba
export const FIGMA_DB_FILE = "figma.db";

// El proyecto de los entornos de prueba: el archivo de Figma es de cada proyecto y sale del registro, no del .env (D-1).
// Se llama «default» para que lo que enseña el panel (selector, indicador) no cambie respecto a antes. Es el primero
// que da de alta la base, así que su id es el 1
export const E2E_PROJECT_ID = "1";
export const E2E_PROJECT_NAME = "default";

// El proyecto del entorno `dir`: su carpeta de salida es la misma que FCC_OUTPUT_DIR
export const e2eProject = (dir: string, fileUrl: string): EntryDraft => ({
	name: E2E_PROJECT_NAME,
	projectDir: dir,
	fileUrl,
	outputDir: join(dir, "salida"),
});

// Un proyecto con el que se puede lanzar el agente: todas sus raíces son suyas, fuera del repo y de la carpeta
// de salida de la máquina (el proyecto de siempre usa los scripts de los escenarios, dentro del repo: el arnés lo rechaza)
export const agentProjectDirs = (dir: string) => ({
	projectDir: join(dir, "proyecto"),
	scriptsRoot: join(dir, "proyecto", "scripts"),
	outputDir: join(dir, "salida-proyecto"),
});
export const agentProject = (dir: string, fileUrl: string): EntryDraft => {
	const d = agentProjectDirs(dir);
	return {
		name: E2E_PROJECT_NAME,
		projectDir: d.projectDir,
		fileUrl,
		scriptsRoots: [d.scriptsRoot],
		outputDir: d.outputDir,
	};
};

export function testEnv(options: EnvOptions): Record<string, string> {
	const { dir } = options;
	return {
		FIGMA_CDP_HOST: LOOPBACK,
		FIGMA_CDP_PORT: String(options.cdpPort),
		FIGMA_CDP_CALL_TIMEOUT_MS: String(TIMING.callTimeoutMs),
		FIGMA_CHROME_PROFILE: join(dir, "perfil"),
		FIGMA_CHROME_SEED_PROFILE: join(dir, "semilla"),
		FIGMA_READY_TIMEOUT_MS: String(TIMING.readyTimeoutMs),
		FCC_SCRIPTS_ROOT: options.scriptsRoot,
		FCC_OUTPUT_DIR: join(dir, "salida"),
		// Los locks de lote son de máquina: en las pruebas, de cada entorno (si no, tocarían ~/.cache del dueño)
		FCC_LOCK_DIR: join(dir, "locks"),
		FCC_SOFT_DEADLINE_MS: String(TIMING.softDeadlineMs),
		FCC_MAX_INLINE_RESULT_BYTES: "20000",
		FCC_ACTIVITY_FILE: join(dir, "activity.jsonl"),
		FCC_ACTIVITY_CODE_PREVIEW_CHARS: "200",
		FCC_DASHBOARD_HOST: LOOPBACK,
		FCC_DASHBOARD_PORT: String(options.dashboardPort),
		FCC_DASHBOARD_HISTORY: "500",
		// Producción, como sin .env: la galería solo la abre quien la pide (el fixture galleryUrl)
		FCC_DASHBOARD_MODE: DASHBOARD_MODE.production,
		// La base única también es del entorno de prueba: guardar desde el panel no toca la de la máquina
		FCC_DB: join(dir, FIGMA_DB_FILE),
		// El registro antiguo (solo lo lee la migración) también: sin esto, el proceso migraría el output/ REAL
		FCC_HISTORY_RETENTION_DAYS: "90",
		FCC_HISTORY_MAX_ROWS: "200",
		FCC_LIVE_POLL_MS: String(TIMING.pollMs),
		FCC_CHAT_POLL_MS: String(TIMING.pollMs),
		FCC_AGENT_TERMINAL: options.agentTerminal,
		FCC_AGENT_LAUNCH_TIMEOUT_MS: String(TIMING.launchTimeoutMs),
		// Entorno de pruebas: `make agent` (agent-run.ts) solo arranca el claude falso de FCC_CLAUDE_BIN
		FCC_TEST_HARNESS: "1",
		// La captura de la web: sus perfiles temporales y el fichero de secretos, del entorno (nunca ~/.config del dueño)
		FCC_WEB_CHROME_PROFILE_DIR: join(dir, "perfiles-captura"),
		FCC_WEB_SECRETS_FILE: join(dir, "secretos.json"),
		...options.extra,
	};
}
