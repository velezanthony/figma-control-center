// Esquema y construcción de `config`. No lee process.env: eso solo lo hace env.ts.
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { z } from "zod";
import type {
	MachineConfig,
	ProjectScope,
	TenantConfig,
} from "#domain/config.ts";
import { figmaFileUrlProblem } from "#domain/figma-url.ts";
import type { RegistryEntry } from "#domain/registry.ts";
import {
	DASHBOARD_MODE,
	type SettingInfo,
	type SettingOrigin,
	type SettingValue,
	type SettingView,
} from "#domain/settings.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

// `~/…` → home del usuario; ruta relativa → relativa a la raíz del repo; absoluta tal cual
// Subcarpeta de FCC_OUTPUT_DIR con los tokens del chat (valor fijo del programa)
const CHAT_TOKENS_DIR = "chat-tokens";

const toAbsolute = (p: string): string =>
	p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(REPO_ROOT, p);

const path = z.string().min(1).transform(toAbsolute);

const insideRepo = (p: string): boolean =>
	p === REPO_ROOT || p.startsWith(`${REPO_ROOT}${sep}`);

const pathList = z
	.string()
	.min(1)
	.transform((list) =>
		list
			.split(delimiter)
			.filter((p) => p !== "")
			.map(toAbsolute),
	);

const positiveInt = z.coerce.number().int().positive();

const port = z.coerce.number().int().min(1).max(65_535);

// El panel no tiene autenticación: solo se admite escuchar en la propia máquina
const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "::1"];
const loopbackHost = z.string().refine((h) => LOOPBACK_HOSTS.includes(h), {
	message: `solo se admite un host local (${LOOPBACK_HOSTS.join(", ")})`,
});

// La orden que abre una terminal («gnome-terminal --»), partida en argumentos: se ejecuta sin shell
const WHITESPACE = /\s+/;
const terminalCommand = z
	.string()
	.transform((line) => line.trim().split(WHITESPACE))
	.refine((argv) => argv[0] !== "", { message: "no puede estar vacía" });

// URL de un archivo de Figma: la regla es la misma que la del registro y la del panel (domain/figma-url.ts)
const fileUrl = z.string().superRefine((u, ctx) => {
	const problem = figmaFileUrlProblem(u);
	if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
});

// Alcance de acceso (FCC_PROJECTS en .mcp.json): "any" (todos) o ids separados por comas. Sin definir, todos
// (compatibilidad); definida pero sin ningún id (vacía, «,»…) no da acceso a nada: abrir no puede ser el efecto de un fallo.
// Ojo Zod 4: el default es el valor de salida (corta el transform), por eso es el objeto ya hecho.
const projectScope = z
	.string()
	.transform((s): ProjectScope => {
		const t = s.trim();
		if (t.toLowerCase() === "any") return { kind: "any" };
		const ids = t
			.split(",")
			.map((x) => x.trim())
			.filter((x) => x !== "");
		return { kind: "ids", ids };
	})
	.default({ kind: "any" });

// Casi todo tiene valor por defecto: el servidor arranca con un .env que solo fije FIGMA_FILE_URL
// (el archivo con el que se trabaja). El .env solo sobrescribe lo que quieras cambiar.
const EnvSchema = z
	.object({
		// --- Chrome con puerto de depuración (transporte CDP) ---
		FIGMA_CDP_HOST: z.string().min(1).default("127.0.0.1"),
		FIGMA_CDP_PORT: port.default(9222),
		FIGMA_CDP_CALL_TIMEOUT_MS: positiveInt.default(300_000),
		FIGMA_CHROME_PROFILE: path
			.refine((p) => !insideRepo(p), {
				message:
					"cae dentro del repo: el perfil guarda la sesión de Figma y git no lo ignora; ponlo fuera (p. ej. ~/.cache/figma-control-center-chrome)",
			})
			.default(toAbsolute("~/.cache/figma-control-center-chrome")),
		// Opcional: perfil del que copiar la sesión la primera vez; sin él, la sesión se inicia con `make login`
		FIGMA_CHROME_SEED_PROFILE: path.optional(),
		// --- Figma ---
		// El proyecto por defecto: el archivo con el que se trabaja. Opcional para el panel (trabaja con el registro);
		// un servidor MCP sin ninguno y sin proyectos en el registro no tiene a qué conectarse y lo dice al arrancar
		FIGMA_FILE_URL: fileUrl.optional(),
		// Archivo de Figma reservado para las pruebas de contrato (make e2e-record / e2e-contract). Opcional: la producción no lo usa
		FIGMA_TEST_FILE_URL: fileUrl.optional(),
		FIGMA_READY_TIMEOUT_MS: positiveInt.default(60_000),
		FCC_SCRIPTS_ROOT: pathList.default([toAbsolute("scripts")]),
		FCC_OUTPUT_DIR: path.default(toAbsolute("output")),
		FCC_SOFT_DEADLINE_MS: positiveInt.default(20_000),
		FCC_MAX_INLINE_RESULT_BYTES: positiveInt.default(20_000),
		// --- Registro de actividad y panel (make dashboard) ---
		// Sin fijar, cuelgan de FCC_OUTPUT_DIR (activity.jsonl, history.db)
		FCC_ACTIVITY_FILE: path.optional(),
		FCC_ACTIVITY_CODE_PREVIEW_CHARS: z.coerce
			.number()
			.int()
			.min(0)
			.default(200),
		FCC_DASHBOARD_HOST: loopbackHost.default("127.0.0.1"),
		FCC_DASHBOARD_PORT: port.default(4173),
		FCC_DASHBOARD_HISTORY: positiveInt.default(500),
		// En desarrollo el panel enseña también la galería de componentes; en producción no aparece
		FCC_DASHBOARD_MODE: z
			.enum(DASHBOARD_MODE)
			.default(DASHBOARD_MODE.production),
		// --- Histórico en SQLite ---
		// La base única de la máquina (proyectos, ajustes e histórico). Es de arranque: sin ella no se puede abrir nada
		FCC_DB: path.default(toAbsolute("output/figma.db")),
		// Solo la config plana de las pruebas de contrato y la migración desde las bases por proyecto
		FCC_DB_PATH: path.optional(),
		FCC_HISTORY_RETENTION_DAYS: positiveInt.default(90),
		FCC_HISTORY_MAX_ROWS: positiveInt.default(200),
		// Cuánto del resultado de cada paso de un lote trae figma_history_call (el resto se pide aparte con `step`)
		FCC_HISTORY_STEP_EXCERPT_BYTES: positiveInt.default(300),
		// Un script (o su contenido en el historial de intentos) que pasa de aquí se guarda solo como hash y tamaño
		FCC_SCRIPT_MAX_BYTES: positiveInt.default(2_000_000),
		// Líneas de diff que figma_history_diff devuelve en la respuesta (el diff entero va a un fichero)
		FCC_HISTORY_DIFF_INLINE_LINES: positiveInt.default(200),
		FCC_LIVE_POLL_MS: positiveInt.default(500),
		FCC_CHAT_POLL_MS: positiveInt.default(700),
		// Marca de lanzamiento: `make agent` la pone a 1; un `claude` normal no la trae. Solo una sesión con la
		// marca se registra como agente de chat (recibe mensajes del panel). Separa «conectó el MCP» de «es un agente».
		FCC_CHAT_AGENT: z.stringbool().default(false),
		FCC_AGENT_TERMINAL: terminalCommand.default(["gnome-terminal", "--"]),
		FCC_AGENT_LAUNCH_TIMEOUT_MS: positiveInt.default(120_000),
		// Vigilancia del panel: cuánto espera agent-run.ts a que vuelva el panel antes de cerrar a
		// claude, y cada cuánto reintenta conectar mientras espera
		FCC_AGENT_PANEL_GRACE_MS: positiveInt.default(10_000),
		FCC_AGENT_WATCH_RETRY_MS: positiveInt.default(1000),
		// El `claude` que arranca `make agent` (agent-run.ts). Sin fijar, el del PATH. Solo lo fijan los tests (el falso)
		FCC_CLAUDE_BIN: path.optional(),
		// Marca del entorno de pruebas (la pone testEnv): ahí agent-run.ts se niega a arrancar un `claude` que no sea el falso
		FCC_TEST_HARNESS: z.stringbool().default(false),
		// Lotes (M2)
		FCC_BUILD_MAX_STEPS: positiveInt.default(50),
		// Lecturas (M3): nodos por llamada a figma_export
		FIGMA_EXPORT_MAX_NODES: positiveInt.default(20),
		// Lecturas: nodos por contexto de diseño de figma_design_context
		FIGMA_DESIGN_CONTEXT_MAX_NODES: positiveInt.default(400),
		FCC_BUILD_STEP_TIMEOUT_MS: positiveInt.default(120_000),
		FCC_PROGRESS_MIN_INTERVAL_MS: positiveInt.default(500),
		FCC_MAX_PARAMS_BYTES: positiveInt.default(20_000),
		FCC_MAX_ASSET_BYTES: positiveInt.default(5_000_000),
		FCC_E2E: z.stringbool().default(false),
		// --- Multi-proyecto ---
		// Locks de lote entre procesos: una carpeta de máquina, igual para todas las sesiones (no sigue a FCC_OUTPUT_DIR)
		FCC_LOCK_DIR: path.default(
			toAbsolute("~/.cache/figma-control-center-locks"),
		),
		// Alcance de acceso del MCP: "any" o ids separados por comas (va en .mcp.json)
		FCC_PROJECTS: projectScope,
		// --- Captura de la web (F1) ---
		// El Chrome sin ventana que se lanza para capturar la web: su propio binario, puerto y perfiles temporales; nunca el
		// Chrome de Figma (FIGMA_CDP_PORT)
		FCC_WEB_CHROME_BIN: z.string().min(1).default("google-chrome"),
		FCC_WEB_CHROME_PORT: port.default(9333),
		FCC_WEB_CHROME_PROFILE_DIR: path.default(tmpdir()),
		// Fichero de la máquina con las contraseñas de los usuarios de captura ({ <secretRef>: <valor> }), fuera de todo repo
		FCC_WEB_SECRETS_FILE: path.default(
			toAbsolute("~/.config/figma-control-center/secrets.json"),
		),
		FCC_WEB_PAGE_TIMEOUT_MS: positiveInt.default(30_000),
		FCC_CAPTURE_MAX_BYTES: positiveInt.default(5_000_000),
		FCC_CONTRACT_INLINE_ERRORS: positiveInt.default(10),
	})
	.superRefine((env, ctx) => {
		if (env.FCC_WEB_CHROME_PORT === env.FIGMA_CDP_PORT)
			ctx.addIssue({
				code: "custom",
				path: ["FCC_WEB_CHROME_PORT"],
				message: `es el mismo puerto que FIGMA_CDP_PORT (${env.FIGMA_CDP_PORT}): el Chrome de captura va aparte del de Figma`,
			});
	});

type Env = z.infer<typeof EnvSchema>;

// Cada variable es EDITABLE (se puede guardar en la base y cambiar desde el panel) o de ARRANQUE (se fija fuera de la
// base: sin ella no se puede abrir nada, o es una ruta, una orden o un permiso que no debe cambiar un ajuste). Un test
// exige que ninguna quede sin clasificar.
export const EDITABLE_KEYS = [
	"FIGMA_CDP_CALL_TIMEOUT_MS",
	"FIGMA_READY_TIMEOUT_MS",
	"FCC_SOFT_DEADLINE_MS",
	"FCC_MAX_INLINE_RESULT_BYTES",
	"FCC_ACTIVITY_CODE_PREVIEW_CHARS",
	"FCC_DASHBOARD_HISTORY",
	"FCC_HISTORY_RETENTION_DAYS",
	"FCC_HISTORY_MAX_ROWS",
	"FCC_HISTORY_STEP_EXCERPT_BYTES",
	"FCC_SCRIPT_MAX_BYTES",
	"FCC_HISTORY_DIFF_INLINE_LINES",
	"FCC_LIVE_POLL_MS",
	"FCC_CHAT_POLL_MS",
	"FCC_AGENT_LAUNCH_TIMEOUT_MS",
	"FCC_AGENT_PANEL_GRACE_MS",
	"FCC_AGENT_WATCH_RETRY_MS",
	"FCC_BUILD_MAX_STEPS",
	"FIGMA_EXPORT_MAX_NODES",
	"FIGMA_DESIGN_CONTEXT_MAX_NODES",
	"FCC_BUILD_STEP_TIMEOUT_MS",
	"FCC_PROGRESS_MIN_INTERVAL_MS",
	"FCC_MAX_PARAMS_BYTES",
	"FCC_MAX_ASSET_BYTES",
	"FCC_WEB_PAGE_TIMEOUT_MS",
	"FCC_CAPTURE_MAX_BYTES",
	"FCC_CONTRACT_INLINE_ERRORS",
] as const;
export const BOOT_KEYS = [
	"FIGMA_CDP_HOST",
	"FIGMA_CDP_PORT",
	"FIGMA_CHROME_PROFILE",
	"FIGMA_CHROME_SEED_PROFILE",
	"FCC_DASHBOARD_HOST",
	"FCC_DASHBOARD_PORT",
	"FCC_DASHBOARD_MODE",
	"FCC_DB",
	"FCC_DB_PATH",
	"FCC_ACTIVITY_FILE",
	"FCC_OUTPUT_DIR",
	"FCC_SCRIPTS_ROOT",
	"FCC_AGENT_TERMINAL",
	"FCC_CLAUDE_BIN",
	"FCC_TEST_HARNESS",
	"FCC_LOCK_DIR",
	"FCC_PROJECTS",
	"FCC_CHAT_AGENT",
	"FIGMA_FILE_URL",
	"FIGMA_TEST_FILE_URL",
	"FCC_E2E",
	"FCC_WEB_CHROME_BIN",
	"FCC_WEB_CHROME_PORT",
	"FCC_WEB_CHROME_PROFILE_DIR",
	"FCC_WEB_SECRETS_FILE",
] as const;
export const ENV_KEYS: readonly string[] = Object.keys(EnvSchema.shape);

export type EditableKey = (typeof EDITABLE_KEYS)[number];

// Grupos de la pantalla de ajustes, en el orden en que salen (las secciones de la plantilla del .env)
const GROUP = {
	chrome: "Chrome y Figma",
	panel: "Panel",
	agent: "Agente",
	history: "Histórico",
	scripts: "Scripts y lotes",
	web: "Captura de la web",
} as const;

const UNIT = {
	ms: "ms",
	bytes: "bytes",
	days: "días",
	rows: "filas",
	chars: "caracteres",
	steps: "pasos",
	nodes: "nodos",
	events: "eventos",
	lines: "líneas",
	errors: "errores",
} as const;

const PANEL = ["panel"] as const;
const AGENT = ["agent"] as const;
const BOTH = ["panel", "agent"] as const;

// La ficha de cada clave editable: la pantalla se pinta con ella, así que una clave nueva
// sale sola. «Quién la usa» es lo comprobado en el código. Un test exige ficha completa para cada una.
export const SETTING_INFO = {
	FIGMA_CDP_CALL_TIMEOUT_MS: {
		group: GROUP.chrome,
		name: "Plazo de cada llamada a Chrome",
		help: "Cuánto espera una llamada al Chrome con puerto de depuración antes de darla por perdida.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FIGMA_READY_TIMEOUT_MS: {
		group: GROUP.chrome,
		name: "Espera a que Figma esté listo",
		help: "Cuánto espera a que la pestaña de Figma tenga el API de plugins disponible.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_DASHBOARD_HISTORY: {
		group: GROUP.panel,
		name: "Eventos al abrir el panel",
		help: "Cuántos eventos recientes manda el panel a una pestaña que se conecta.",
		unit: UNIT.events,
		usedBy: PANEL,
	},
	FCC_LIVE_POLL_MS: {
		group: GROUP.panel,
		name: "Sondeo en vivo del panel",
		help: "Cada cuánto mira el panel si hay actividad o mensajes de chat nuevos.",
		unit: UNIT.ms,
		usedBy: PANEL,
	},
	FCC_CHAT_POLL_MS: {
		group: GROUP.panel,
		name: "Sondeo del chat en el agente",
		help: "Cada cuánto mira el agente si hay mensajes nuevos del chat del panel.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_AGENT_LAUNCH_TIMEOUT_MS: {
		group: GROUP.agent,
		name: "Espera al lanzar el agente",
		help: "Cuánto espera el panel a que el agente que lanza se conecte.",
		unit: UNIT.ms,
		usedBy: PANEL,
	},
	FCC_AGENT_PANEL_GRACE_MS: {
		group: GROUP.agent,
		name: "Margen si el panel se cae",
		help: "Cuánto espera el agente a que vuelva el panel antes de cerrarse.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_AGENT_WATCH_RETRY_MS: {
		group: GROUP.agent,
		name: "Reintento de conexión con el panel",
		help: "Cada cuánto reintenta el agente conectar con el panel mientras lo espera.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_HISTORY_RETENTION_DAYS: {
		group: GROUP.history,
		name: "Días que se guarda el histórico",
		help: "Lo que sea más antiguo se borra del histórico.",
		unit: UNIT.days,
		usedBy: BOTH,
	},
	FCC_HISTORY_MAX_ROWS: {
		group: GROUP.history,
		name: "Filas por consulta del histórico",
		help: "Tope de filas que devuelve una consulta del histórico, aunque se pidan más.",
		unit: UNIT.rows,
		usedBy: BOTH,
	},
	FCC_HISTORY_STEP_EXCERPT_BYTES: {
		group: GROUP.history,
		name: "Extracto de cada paso de un lote",
		help: "Cuánto del resultado de cada paso trae figma_history_call; el resto se pide aparte.",
		unit: UNIT.bytes,
		usedBy: BOTH,
	},
	FCC_HISTORY_DIFF_INLINE_LINES: {
		group: GROUP.history,
		name: "Líneas de diff en la respuesta",
		help: "Cuántas líneas de diff devuelve figma_history_diff en la respuesta; el diff entero queda en un fichero.",
		unit: UNIT.lines,
		usedBy: AGENT,
	},
	FCC_SCRIPT_MAX_BYTES: {
		group: GROUP.history,
		name: "Tamaño máximo de un script guardado",
		help: "Lo que pase de aquí se guarda solo como hash en el historial de intentos.",
		unit: UNIT.bytes,
		usedBy: BOTH,
	},
	FCC_SOFT_DEADLINE_MS: {
		group: GROUP.scripts,
		name: "Plazo blando de un script",
		help: "Pasado este tiempo, figma_run_script responde que sigue en marcha y da un jobId.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_MAX_INLINE_RESULT_BYTES: {
		group: GROUP.scripts,
		name: "Resultado en la respuesta",
		help: "Un resultado más grande se guarda en disco y la respuesta lleva su ruta.",
		unit: UNIT.bytes,
		usedBy: AGENT,
	},
	FCC_ACTIVITY_CODE_PREVIEW_CHARS: {
		group: GROUP.scripts,
		name: "Vista previa del código",
		help: "Cuántos caracteres del código de un script se guardan en el histórico.",
		unit: UNIT.chars,
		usedBy: AGENT,
	},
	FCC_BUILD_MAX_STEPS: {
		group: GROUP.scripts,
		name: "Pasos por lote",
		help: "Cuántos pasos admite como mucho un figma_build.",
		unit: UNIT.steps,
		usedBy: AGENT,
	},
	FIGMA_EXPORT_MAX_NODES: {
		group: GROUP.scripts,
		name: "Nodos por exportación",
		help: "Cuántos nodos admite como mucho un figma_export.",
		unit: UNIT.nodes,
		usedBy: AGENT,
	},
	FIGMA_DESIGN_CONTEXT_MAX_NODES: {
		group: GROUP.scripts,
		name: "Nodos por contexto de diseño",
		help: "Cuántos nodos lee como mucho figma_design_context por llamada; el resto sale en `truncated` para pedirlo aparte.",
		unit: UNIT.nodes,
		usedBy: AGENT,
	},
	FCC_BUILD_STEP_TIMEOUT_MS: {
		group: GROUP.scripts,
		name: "Plazo de cada paso de un lote",
		help: "Cuánto puede tardar un paso de un lote antes de darlo por fallido.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_PROGRESS_MIN_INTERVAL_MS: {
		group: GROUP.scripts,
		name: "Intervalo del progreso de un lote",
		help: "Tiempo mínimo entre dos avisos de progreso de un lote.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_MAX_PARAMS_BYTES: {
		group: GROUP.scripts,
		name: "Tamaño de los params",
		help: "Lo que pueden ocupar los params de un script o de un lote.",
		unit: UNIT.bytes,
		usedBy: AGENT,
	},
	FCC_MAX_ASSET_BYTES: {
		group: GROUP.scripts,
		name: "Tamaño de los assets",
		help: "Lo que pueden ocupar entre todos los assets de una llamada.",
		unit: UNIT.bytes,
		usedBy: AGENT,
	},
	FCC_WEB_PAGE_TIMEOUT_MS: {
		group: GROUP.web,
		name: "Espera de cada pantalla",
		help: "Cuánto puede tardar cada variante de una pantalla en cargar, iniciar sesión y llegar a su estado (until) al capturar la web.",
		unit: UNIT.ms,
		usedBy: AGENT,
	},
	FCC_CAPTURE_MAX_BYTES: {
		group: GROUP.web,
		name: "Tamaño máximo de una captura de la web",
		help: "Lo que puede ocupar el JSON de una captura de la web, sin contar las imágenes; si pasa, se guarda como rechazada.",
		unit: UNIT.bytes,
		usedBy: AGENT,
	},
	FCC_CONTRACT_INLINE_ERRORS: {
		group: GROUP.web,
		name: "Errores de contrato en la respuesta",
		help: "Cuántos errores de contrato trae la respuesta de figma_capture; la lista entera va al fichero de errores.",
		unit: UNIT.errors,
		usedBy: AGENT,
	},
} as const satisfies Readonly<Record<EditableKey, SettingInfo>>;

const isEditable = (key: string): boolean =>
	(EDITABLE_KEYS as readonly string[]).includes(key);
const isBoot = (key: string): boolean =>
	(BOOT_KEYS as readonly string[]).includes(key);
const fieldOf = (key: string): z.ZodType | undefined =>
	(EnvSchema.shape as Record<string, z.ZodType>)[key];

// Por qué una clave no es un ajuste editable (de arranque o desconocida), o null si lo es
export function editableKeyProblem(key: string): string | null {
	if (isBoot(key)) {
		return `«${key}» es de arranque: se fija en el entorno (.env), no desde la base`;
	}
	if (fieldOf(key) === undefined || !isEditable(key)) {
		return `«${key}» es una clave de ajuste desconocida`;
	}
	return null;
}

// El valor de un ajuste como lo lee zod, como texto (« 500 » → «500»). Solo para un valor que ya pasó validateSetting
export const normalizeSetting = (key: string, value: string): string =>
	String((fieldOf(key) as z.ZodType).parse(value));

// Si el entorno fija una clave: trae un valor que vale, así que manda sobre lo guardado (el origen «env»)
export function setByEnvironment(
	source: Readonly<Record<string, string | undefined>>,
	key: string,
): boolean {
	const fromEnv = source[key];
	const field = fieldOf(key);
	return fromEnv !== undefined && field?.safeParse(fromEnv).success === true;
}

const MUST_BE_INTEGER = "Tiene que ser un número entero";

// El mensaje de zod en castellano llano, para quien edita un ajuste en el panel. Es el `error` de la lectura (el camino
// oficial de zod 4), no un parche sobre su texto; devolver undefined deja el mensaje propio del campo. Un sitio para todos
function plainMessage(issue: z.core.$ZodRawIssue): string | undefined {
	switch (issue.code) {
		case "invalid_type":
			return `${MUST_BE_INTEGER}.`;
		case "too_small":
			return `${MUST_BE_INTEGER} ${issue.inclusive === true ? "igual o mayor" : "mayor"} que ${String(issue.minimum)}.`;
		case "too_big":
			return `${MUST_BE_INTEGER} ${issue.inclusive === true ? "igual o menor" : "menor"} que ${String(issue.maximum)}.`;
		default:
			return undefined;
	}
}

// Por qué un valor no vale para una clave editable (sin repetir la clave: la fila ya la enseña), o null si vale
function valueProblem(key: string, value: string): string | null {
	const parsed = (fieldOf(key) as z.ZodType).safeParse(value, {
		error: plainMessage,
	});
	return parsed.success
		? null
		: (parsed.error.issues[0]?.message ?? "Valor inválido.");
}

// Por qué un ajuste (clave y valor) no se puede guardar, o null si vale
export function validateSetting(key: string, value: string): string | null {
	return editableKeyProblem(key) ?? valueProblem(key, value);
}

// ¿El valor (ya válido) es el que la clave tiene por defecto? Se compara como lo lee zod (« 50 » = 50)
export const isSettingDefault = (key: string, value: string): boolean =>
	normalizeSetting(key, value) ===
	String(resolveSetting(key as EditableKey, {}, {}).value);

// Los ajustes guardados que valen (clave editable y valor válido) y por qué se descarta el resto
function usableSettings(stored: Readonly<Record<string, string>>): {
	readonly accepted: Record<string, string>;
	readonly problems: string[];
} {
	const accepted: Record<string, string> = {};
	const problems: string[] = [];
	for (const [key, value] of Object.entries(stored)) {
		const keyProblem = editableKeyProblem(key);
		const problem = keyProblem ?? valueProblem(key, value);
		if (problem === null) accepted[key] = value;
		else
			problems.push(
				`ajuste ignorado: ${keyProblem === null ? `«${key}»: ${problem}` : problem}`,
			);
	}
	return { accepted, problems };
}

const definedOnly = (
	source: Readonly<Record<string, string | undefined>>,
): Record<string, string> =>
	Object.fromEntries(
		Object.entries(source).filter(
			(e): e is [string, string] => e[1] !== undefined,
		),
	);

// Por qué se descartan algunos de los ajustes guardados (clave desconocida, de arranque o valor inválido)
export const settingProblems = (
	stored: Readonly<Record<string, string>>,
): readonly string[] => usableSettings(stored).problems;

// El valor de una clave editable con lo guardado que vale y el entorno (default < panel < env), y de dónde sale
function resolveSetting(
	key: EditableKey,
	source: Readonly<Record<string, string | undefined>>,
	accepted: Readonly<Record<string, string>>,
): { readonly value: SettingValue; readonly origin: SettingOrigin } {
	const field = fieldOf(key) as z.ZodType;
	const fromEnv = source[key];
	const origin: SettingOrigin = setByEnvironment(source, key)
		? "env"
		: accepted[key] !== undefined
			? "panel"
			: "default";
	const raw = origin === "env" ? fromEnv : accepted[key];
	return { value: field.parse(raw) as SettingValue, origin };
}

// Cada ajuste editable con su ficha, lo guardado, su valor por defecto, el valor con el que corre lo que arranque ahora
// y de dónde sale (default < panel < env), y con qué valor arrancó quien pregunta (`storedAtBoot`: lo guardado cuando
// arrancó; sin él, como si no hubiera nada guardado)
export function describeSettings(
	source: Readonly<Record<string, string | undefined>>,
	stored: Readonly<Record<string, string>>,
	storedAtBoot: Readonly<Record<string, string>> = {},
): readonly SettingView[] {
	const now = usableSettings(stored).accepted;
	const atBoot = usableSettings(storedAtBoot).accepted;
	return EDITABLE_KEYS.map((key): SettingView => {
		const { value, origin } = resolveSetting(key, source, now);
		return {
			key,
			...SETTING_INFO[key],
			stored: stored[key] ?? null,
			effective: value,
			origin,
			default: resolveSetting(key, {}, {}).value,
			running: resolveSetting(key, source, atBoot).value,
		};
	});
}

function validate(
	source: Readonly<Record<string, string | undefined>>,
	origin: string,
): Env {
	const parsed = EnvSchema.safeParse(source);
	if (!parsed.success) {
		throw new Error(
			`Configuración inválida (revisa ${origin}; plantilla en .env.example):\n${z.prettifyError(parsed.error)}`,
		);
	}
	return parsed.data;
}

// Entrada/salida de la config: se inyecta para que el esquema siga sin tocar el sistema de ficheros ni la consola
export type ConfigIo = {
	exists(path: string): boolean;
	warn(message: string): void;
};
const NO_IO: ConfigIo = { exists: () => false, warn: () => {} };

// Antes de que las rutas siguieran a FCC_OUTPUT_DIR todo vivía en output/ del repo
const LEGACY_OUTPUT_DIR = toAbsolute("output");

// `next` (lo que cuelga de FCC_OUTPUT_DIR), salvo que no exista y la ruta antigua sí: entonces la antigua, avisando,
// para no dejar a nadie sin su histórico al actualizar
function keepLegacy(
	next: string,
	legacy: string,
	io: ConfigIo,
	how: string,
): string {
	if (next === legacy || io.exists(next) || !io.exists(legacy)) return next;
	io.warn(
		`figma-control-center: uso ${legacy} porque ${next} no existe (ahora estas rutas cuelgan de FCC_OUTPUT_DIR). ${how}`,
	);
	return legacy;
}

// Dónde van el histórico y el registro de actividad del proyecto por defecto
function defaultFiles(env: Env, io: ConfigIo) {
	const derived = (name: string, variable: string) =>
		keepLegacy(
			join(env.FCC_OUTPUT_DIR, name),
			join(LEGACY_OUTPUT_DIR, name),
			io,
			`Para fijarla pon ${variable} en .env, o mueve el fichero a la ruta nueva.`,
		);
	return {
		dbPath: env.FCC_DB_PATH ?? derived("history.db", "FCC_DB_PATH"),
		activityFile:
			env.FCC_ACTIVITY_FILE ?? derived("activity.jsonl", "FCC_ACTIVITY_FILE"),
	};
}

// Config plana de un solo proyecto: API de las pruebas de contrato (que necesitan FIGMA_FILE_URL y trabajan con un
// único archivo). La producción usa `parseLayered`.
export function parseConfig(
	source: Readonly<Record<string, string | undefined>>,
	origin: string,
	io: ConfigIo = NO_IO,
) {
	const env = validate(source, origin);
	const figmaFileUrl = env.FIGMA_FILE_URL;
	if (figmaFileUrl === undefined) {
		throw new Error(
			`Configuración inválida (revisa ${origin}; plantilla en .env.example):\n✖ FIGMA_FILE_URL: obligatoria para esta configuración`,
		);
	}
	const files = defaultFiles(env, io);
	return Object.freeze({
		cdp: Object.freeze({
			host: env.FIGMA_CDP_HOST,
			port: env.FIGMA_CDP_PORT,
			callTimeoutMs: env.FIGMA_CDP_CALL_TIMEOUT_MS,
		}),
		chrome: Object.freeze({
			profile: env.FIGMA_CHROME_PROFILE,
			seedProfile: env.FIGMA_CHROME_SEED_PROFILE ?? null,
		}),
		figma: Object.freeze({
			fileUrl: figmaFileUrl,
			testFileUrl: env.FIGMA_TEST_FILE_URL ?? null,
			readyTimeoutMs: env.FIGMA_READY_TIMEOUT_MS,
		}),
		scripts: Object.freeze({
			roots: Object.freeze(env.FCC_SCRIPTS_ROOT),
			// Las rutas relativas que reciben las herramientas se resuelven contra la raíz del repo
			baseDir: REPO_ROOT,
		}),
		output: Object.freeze({
			dir: env.FCC_OUTPUT_DIR,
			maxInlineResultBytes: env.FCC_MAX_INLINE_RESULT_BYTES,
		}),
		jobs: Object.freeze({ softDeadlineMs: env.FCC_SOFT_DEADLINE_MS }),
		activity: Object.freeze({
			file: files.activityFile,
			codePreviewChars: env.FCC_ACTIVITY_CODE_PREVIEW_CHARS,
		}),
		dashboard: Object.freeze({
			host: env.FCC_DASHBOARD_HOST,
			port: env.FCC_DASHBOARD_PORT,
			historyEvents: env.FCC_DASHBOARD_HISTORY,
		}),
		history: Object.freeze({
			dbPath: files.dbPath,
			retentionDays: env.FCC_HISTORY_RETENTION_DAYS,
			maxRows: env.FCC_HISTORY_MAX_ROWS,
			stepExcerptBytes: env.FCC_HISTORY_STEP_EXCERPT_BYTES,
			scriptMaxBytes: env.FCC_SCRIPT_MAX_BYTES,
			diffInlineLines: env.FCC_HISTORY_DIFF_INLINE_LINES,
		}),
		live: Object.freeze({ pollMs: env.FCC_LIVE_POLL_MS }),
		chat: Object.freeze({
			pollMs: env.FCC_CHAT_POLL_MS,
			// Donde cada sesión deja su token para que el panel firme sus mensajes
			tokensDir: join(env.FCC_OUTPUT_DIR, CHAT_TOKENS_DIR),
			// Solo las sesiones lanzadas como agente (`make agent`) atienden el chat del panel
			agent: env.FCC_CHAT_AGENT,
		}),
		agent: Object.freeze({
			terminal: Object.freeze(env.FCC_AGENT_TERMINAL),
			launchTimeoutMs: env.FCC_AGENT_LAUNCH_TIMEOUT_MS,
		}),
		build: Object.freeze({
			maxSteps: env.FCC_BUILD_MAX_STEPS,
			stepTimeoutMs: env.FCC_BUILD_STEP_TIMEOUT_MS,
			progressMinIntervalMs: env.FCC_PROGRESS_MIN_INTERVAL_MS,
			maxParamsBytes: env.FCC_MAX_PARAMS_BYTES,
			maxAssetBytes: env.FCC_MAX_ASSET_BYTES,
		}),
		read: Object.freeze({
			exportMaxNodes: env.FIGMA_EXPORT_MAX_NODES,
			designContextMaxNodes: env.FIGMA_DESIGN_CONTEXT_MAX_NODES,
		}),
		e2e: Object.freeze({ enabled: env.FCC_E2E }),
	});
}

export type Config = ReturnType<typeof parseConfig>;

// Lo que avisan el servidor MCP y el panel (una vez, al arrancar) si el entorno aún fija FIGMA_FILE_URL
export const FILE_URL_IGNORED_WARNING =
	"FIGMA_FILE_URL ya no se usa: el archivo de Figma es de cada proyecto. Da de alta el proyecto en la página «Proyectos» del panel.";

// Config en dos capas: lo de máquina y el alcance de acceso. Los proyectos salen solo del
// registro: el archivo de Figma es de cada proyecto, no del .env (D-1).
export type LayeredConfig = {
	machine: MachineConfig;
	// FIGMA_FILE_URL sigue en el entorno pero ya no se usa: quien arranca avisa una vez
	fileUrlIgnored: boolean;
	scope: ProjectScope;
	// Una fila del registro con los valores por defecto de esta configuración aplicados
	resolveEntry: (entry: RegistryEntry) => TenantConfig;
	// La carpeta de salida (FCC_OUTPUT_DIR) y dónde van los ficheros de un proyecto que no fija la suya: <salida>/<id>
	outputRoot: string;
	outputDirFor: (id: string) => string;
	// La raíz de scripts por defecto de la máquina (FCC_SCRIPTS_ROOT), la de los proyectos sin raíz propia
	defaultScriptsRoots: readonly string[];
	settingProblems: readonly string[];
};

export function parseLayered(
	source: Readonly<Record<string, string | undefined>>,
	origin: string,
	stored: Readonly<Record<string, string>> = {},
): LayeredConfig {
	// default < ajuste guardado < entorno: lo guardado entra por debajo de lo que fija el entorno
	const { accepted, problems } = usableSettings(stored);
	const env = validate({ ...accepted, ...definedOnly(source) }, origin);
	const machine: MachineConfig = {
		cdp: {
			host: env.FIGMA_CDP_HOST,
			port: env.FIGMA_CDP_PORT,
			callTimeoutMs: env.FIGMA_CDP_CALL_TIMEOUT_MS,
		},
		chrome: {
			profile: env.FIGMA_CHROME_PROFILE,
			seedProfile: env.FIGMA_CHROME_SEED_PROFILE ?? null,
		},
		figma: {
			testFileUrl: env.FIGMA_TEST_FILE_URL ?? null,
			readyTimeoutMs: env.FIGMA_READY_TIMEOUT_MS,
		},
		scriptsBaseDir: REPO_ROOT,
		output: { maxInlineResultBytes: env.FCC_MAX_INLINE_RESULT_BYTES },
		jobs: { softDeadlineMs: env.FCC_SOFT_DEADLINE_MS },
		activity: { codePreviewChars: env.FCC_ACTIVITY_CODE_PREVIEW_CHARS },
		dashboard: {
			host: env.FCC_DASHBOARD_HOST,
			port: env.FCC_DASHBOARD_PORT,
			historyEvents: env.FCC_DASHBOARD_HISTORY,
			mode: env.FCC_DASHBOARD_MODE,
		},
		history: {
			retentionDays: env.FCC_HISTORY_RETENTION_DAYS,
			maxRows: env.FCC_HISTORY_MAX_ROWS,
			stepExcerptBytes: env.FCC_HISTORY_STEP_EXCERPT_BYTES,
			scriptMaxBytes: env.FCC_SCRIPT_MAX_BYTES,
			diffInlineLines: env.FCC_HISTORY_DIFF_INLINE_LINES,
		},
		live: { pollMs: env.FCC_LIVE_POLL_MS },
		chat: { pollMs: env.FCC_CHAT_POLL_MS, agent: env.FCC_CHAT_AGENT },
		agent: {
			terminal: env.FCC_AGENT_TERMINAL,
			launchTimeoutMs: env.FCC_AGENT_LAUNCH_TIMEOUT_MS,
			panelGraceMs: env.FCC_AGENT_PANEL_GRACE_MS,
			watchRetryMs: env.FCC_AGENT_WATCH_RETRY_MS,
			claudeBin: env.FCC_CLAUDE_BIN ?? null,
			testHarness: env.FCC_TEST_HARNESS,
		},
		build: {
			maxSteps: env.FCC_BUILD_MAX_STEPS,
			stepTimeoutMs: env.FCC_BUILD_STEP_TIMEOUT_MS,
			progressMinIntervalMs: env.FCC_PROGRESS_MIN_INTERVAL_MS,
			maxParamsBytes: env.FCC_MAX_PARAMS_BYTES,
			maxAssetBytes: env.FCC_MAX_ASSET_BYTES,
		},
		read: {
			exportMaxNodes: env.FIGMA_EXPORT_MAX_NODES,
			designContextMaxNodes: env.FIGMA_DESIGN_CONTEXT_MAX_NODES,
		},
		e2e: { enabled: env.FCC_E2E },
		web: {
			chromeBin: env.FCC_WEB_CHROME_BIN,
			chromePort: env.FCC_WEB_CHROME_PORT,
			profileDir: env.FCC_WEB_CHROME_PROFILE_DIR,
			secretsFile: env.FCC_WEB_SECRETS_FILE,
			pageTimeoutMs: env.FCC_WEB_PAGE_TIMEOUT_MS,
			captureMaxBytes: env.FCC_CAPTURE_MAX_BYTES,
			contractInlineErrors: env.FCC_CONTRACT_INLINE_ERRORS,
		},
		locksDir: env.FCC_LOCK_DIR,
		dbPath: env.FCC_DB,
	};
	const defaults = {
		scriptsRoots: env.FCC_SCRIPTS_ROOT,
		outputDir: env.FCC_OUTPUT_DIR,
	};
	return {
		machine,
		fileUrlIgnored: env.FIGMA_FILE_URL !== undefined,
		scope: env.FCC_PROJECTS,
		resolveEntry: (entry) => tenantFromEntry(entry, defaults),
		outputRoot: defaults.outputDir,
		outputDirFor: (id) => join(defaults.outputDir, id),
		defaultScriptsRoots: defaults.scriptsRoots,
		settingProblems: problems,
	};
}

// Resuelve una fila del registro a TenantConfig aplicando los defaults: lo que la fila no fija cae a
// <FCC_OUTPUT_DIR>/<id>; scriptsRoots cae al default de máquina que se le pasa.
export function tenantFromEntry(
	entry: RegistryEntry,
	defaults: {
		readonly scriptsRoots: readonly string[];
		readonly outputDir: string;
	},
): TenantConfig {
	const outputDir = entry.outputDir
		? toAbsolute(entry.outputDir)
		: join(defaults.outputDir, entry.id);
	return {
		id: entry.id,
		name: entry.name,
		fileUrl: entry.fileUrl,
		projectDir: toAbsolute(entry.projectDir),
		scriptsRoots: entry.scriptsRoots
			? entry.scriptsRoots.map(toAbsolute)
			: defaults.scriptsRoots,
		outputDir,
		activityFile: join(outputDir, "activity.jsonl"),
	};
}
