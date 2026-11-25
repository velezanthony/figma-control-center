// El arnés de un agente lanzado desde el panel: con qué opciones, ajustes, MCP y entorno
// arranca `claude` para que solo vea el proyecto elegido. Función pura: las rutas llegan ya resueltas (realpath) y
// todo lo que sale se compara entero en los tests. Rutas POSIX: el panel y Claude Code corren en Linux.
import { err, ok, type Result } from "./result.ts";
import { CHAT_AGENT_DENIED_TOOLS, TOOL_NAME } from "./tool-names.ts";

export const AGENT_SERVER = "figma-control-center";
// Solo lectura: el agente del chat consulta, no escribe (las de escritura además se deniegan)
export const AGENT_TOOLS = ["Read", "Glob", "Grep"] as const;
export const FILE_WRITE_TOOLS = ["Write", "Edit", "NotebookEdit"] as const;
export const SETTINGS_FILE = "settings.json";
export const MCP_CONFIG_FILE = "mcp.json";
export const LAUNCH_FILE = "launch.json";
// Prefijo de la carpeta de cada lanzamiento (`<tmp>/figma-agent-<launchId>`): el barrido de huérfanas la busca por él
export const LAUNCH_DIR_PREFIX = "figma-agent-";
// Subcarpeta de cada carpeta de salida con los tokens del chat (la misma que usan la sesión y el panel)
export const CHAT_TOKENS_DIR = "chat-tokens";

// Lo único del entorno de quien lanza que llega a `claude` (más las variables `LC_*`)
export const AGENT_ENV_WHITELIST = [
	"PATH",
	"HOME",
	"USER",
	"LANG",
	"TERM",
	"COLORTERM",
	"DISPLAY",
	"WAYLAND_DISPLAY",
	"XDG_RUNTIME_DIR",
	"DBUS_SESSION_BUS_ADDRESS",
] as const;
const LOCALE_PREFIX = "LC_";

// Nombres de fichero que son secretos en cualquier carpeta (sintaxis gitignore)
export const SECRET_NAMES = [
	".env",
	".env.*",
	".envrc",
	"*.pem",
	"*.key",
	"id_rsa*",
	".npmrc",
	".netrc",
] as const;
// Carpetas del home con credenciales
export const SECRET_HOME_DIRS = [
	".ssh",
	".aws",
	".config/gcloud",
	".claude",
] as const;
// Lo que no se escribe en ninguna raíz: cambiaría la siguiente sesión normal del usuario
const CONFIG_NAMES = [
	"**/.claude/**",
	"**/.mcp.json",
	"**/CLAUDE.md",
	"**/.git/**",
];
const DENIED_TOOLS = ["Bash", "WebFetch", "WebSearch", "Bash(git push *)"];

// Herramientas del servidor que usa sin preguntar: lecturas, histórico y la respuesta al chat
const MCP_READS = [
	TOOL_NAME.status,
	TOOL_NAME.screenshot,
	TOOL_NAME.metadata,
	TOOL_NAME.variables,
	TOOL_NAME.styles,
	TOOL_NAME.components,
	TOOL_NAME.instances,
	TOOL_NAME.export,
	TOOL_NAME.designContext,
	TOOL_NAME.getJob,
	TOOL_NAME.historySummary,
	TOOL_NAME.historyErrors,
	TOOL_NAME.historyNodes,
	TOOL_NAME.historySessions,
	TOOL_NAME.historySearch,
	TOOL_NAME.historyCall,
	TOOL_NAME.historyAttempts,
	TOOL_NAME.historyScript,
	TOOL_NAME.historyDiff,
	TOOL_NAME.chatReply,
];
export const mcpTool = (name: string): string =>
	`mcp__${AGENT_SERVER}__${name}`;
const GUARD_MATCHER = `Read|Glob|Grep|Write|Edit|NotebookEdit|mcp__${AGENT_SERVER}__.*`;

// Una raíz tal como la escribió el proyecto y ya resuelta (null: no existe)
export type CheckedRoot = {
	readonly given: string;
	readonly real: string | null;
};

export type HarnessProject = {
	readonly id: string;
	readonly projectDir: CheckedRoot;
	readonly scriptsRoots: readonly CheckedRoot[];
	readonly outputDir: CheckedRoot;
};

// Lo de la máquina, todo en absoluto y resuelto
export type HarnessMachine = {
	readonly repoRoot: string;
	readonly home: string;
	readonly nodeBin: string;
	readonly launchDir: string;
	// FCC_OUTPUT_DIR: la carpeta de salida de la máquina
	readonly outputRoot: string;
	// La base única (proyectos e histórico de todos)
	readonly dbPath: string;
	// El fichero de secretos de la captura de la web (FCC_WEB_SECRETS_FILE): el agente nunca lo lee ni lo escribe
	readonly secretsFile: string;
	// La raíz de scripts por defecto (la de los proyectos sin raíz propia): compartida por todos (D-5)
	readonly defaultScriptsRoots: readonly string[];
	// Las raíces del resto de proyectos del registro (las que existen, resueltas)
	readonly otherProjects: readonly {
		readonly id: string;
		readonly roots: readonly string[];
	}[];
};

// Lo que lee el guardián `PreToolUse` (agent-guard.ts): dentro de qué raíces vale una ruta y qué rutas nunca
export type GuardRules = {
	readonly repoRoot: string;
	readonly roots: readonly string[];
	readonly denied: readonly string[];
};

// Lo que el lanzamiento deja en `launch.json`: la orden, el cwd, el entorno propio, las reglas del guardián y el pid de
// quien lo vigila (el panel al crearla, agent-run.ts al arrancar): con ese pid muerto, la carpeta es huérfana
export type LaunchFile = {
	readonly projectId: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly guard: GuardRules;
	readonly pid: number;
};

export type AgentHarness = {
	readonly settings: Readonly<Record<string, unknown>>;
	readonly mcpConfig: Readonly<Record<string, unknown>>;
	// Argumentos de `claude` (el binario lo elige quien lo ejecuta)
	readonly args: readonly string[];
	readonly cwd: string;
	// Lo que se añade a la lista blanca del entorno
	readonly env: Readonly<Record<string, string>>;
	readonly guard: GuardRules;
};

export type UnsafeProjectPaths = {
	readonly type: "UnsafeProjectPaths";
	readonly message: string;
};

const ROOT = "/";

const isWithin = (parent: string, child: string): boolean =>
	parent === ROOT || child === parent || child.startsWith(`${parent}/`);
const overlap = (a: string, b: string): boolean =>
	isWithin(a, b) || isWithin(b, a);
// Regla de permisos con ruta absoluta: `//ruta` (una sola `/` sería relativa al fichero de settings)
const abs = (path: string): string => `/${path}`;
// Comillas simples de shell: el hook es una orden que Claude Code pasa a un shell
const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

type Labeled = { readonly label: string; readonly root: CheckedRoot };

function rootProblems(
	{ label, root }: Labeled,
	project: HarnessProject,
	machine: HarnessMachine,
	isOutput: boolean,
): string[] {
	const named = `${label} «${root.given}»`;
	const real = root.real;
	if (real === null) return [`${named} no existe`];
	const problems: string[] = [];
	if (real === ROOT) problems.push(`${named} es la raíz del sistema`);
	else if (real === machine.home)
		problems.push(`${named} es tu carpeta personal`);
	else if (isWithin(real, machine.home))
		problems.push(`${named} contiene tu carpeta personal`);
	if (real === machine.repoRoot)
		problems.push(`${named} es el repo de la herramienta`);
	else if (isWithin(real, machine.repoRoot))
		problems.push(`${named} contiene el repo de la herramienta`);
	else if (isWithin(machine.repoRoot, real)) {
		problems.push(
			machine.defaultScriptsRoots.some((d) => isWithin(d, real))
				? `${named} es la raíz de scripts por defecto de la máquina, compartida por los proyectos sin raíz propia: dale al proyecto su propia raíz de scripts`
				: `${named} está dentro del repo de la herramienta`,
		);
	}
	for (const other of machine.otherProjects) {
		if (other.id === project.id) continue;
		const clash = other.roots.find((r) => overlap(r, real));
		if (clash !== undefined)
			problems.push(
				`${named} se solapa con «${clash}» del proyecto ${other.id}`,
			);
	}
	if (isOutput) {
		if (isWithin(real, `${machine.outputRoot}/${CHAT_TOKENS_DIR}`))
			problems.push(`${named} contiene los tokens del chat de la máquina`);
		if (isWithin(real, machine.dbPath))
			problems.push(
				`${named} contiene la base de la máquina (todos los proyectos)`,
			);
	}
	return problems;
}

export function agentHarness(
	project: HarnessProject,
	machine: HarnessMachine,
): Result<AgentHarness, UnsafeProjectPaths> {
	const labeled: Labeled[] = [
		{ label: "la carpeta del proyecto", root: project.projectDir },
		...project.scriptsRoots.map((root) => ({
			label: "la raíz de scripts",
			root,
		})),
		{ label: "la carpeta de salida", root: project.outputDir },
	];
	const problems = labeled.flatMap((l) =>
		rootProblems(l, project, machine, l.root === project.outputDir),
	);
	const reals = labeled.flatMap((l) =>
		l.root.real === null ? [] : [l.root.real],
	);
	const holder = reals.find((r) => isWithin(r, machine.launchDir));
	if (holder !== undefined)
		problems.push(
			`la carpeta del lanzamiento («${machine.launchDir}») caería dentro de «${holder}»`,
		);
	if (problems.length > 0) {
		return err({
			type: "UnsafeProjectPaths",
			message: `No se puede lanzar el agente del proyecto ${project.id}: ${problems.join("; ")}. Revisa sus raíces en la página «Proyectos».`,
		});
	}
	return ok(
		build(
			project.id,
			project.projectDir.real as string,
			project.scriptsRoots.map((r) => r.real as string),
			project.outputDir.real as string,
			machine,
		),
	);
}

function build(
	id: string,
	projectDir: string,
	scriptsRoots: readonly string[],
	outputDir: string,
	machine: HarnessMachine,
): AgentHarness {
	// Fuera del proyecto, solo para leer: los scripts y lo que deja el servidor (resultados, lecturas, capturas)
	const readable = [...scriptsRoots, outputDir];
	const machineTokens = `${machine.outputRoot}/${CHAT_TOKENS_DIR}`;
	const projectTokens = `${outputDir}/${CHAT_TOKENS_DIR}`;
	const dbFiles = [
		machine.dbPath,
		`${machine.dbPath}-wal`,
		`${machine.dbPath}-shm`,
	];
	const repoEnv = `${machine.repoRoot}/.env`;
	const settings = {
		permissions: {
			defaultMode: "default",
			disableBypassPermissionsMode: "disable",
			blockReadsOutsideWorkingDirectories: true,
			blockWritesOutsideWorkingDirectories: true,
			allow: MCP_READS.map(mcpTool),
			deny: [
				...SECRET_NAMES.map((n) => `Read(**/${n})`),
				...SECRET_HOME_DIRS.map((d) => `Read(~/${d}/**)`),
				`Read(${abs(repoEnv)})`,
				`Read(${abs(repoEnv)}.*)`,
				`Read(**/${CHAT_TOKENS_DIR}/**)`,
				`Edit(**/${CHAT_TOKENS_DIR}/**)`,
				`Read(${abs(machineTokens)}/**)`,
				`Read(${abs(projectTokens)}/**)`,
				...dbFiles.map((f) => `Read(${abs(f)})`),
				`Read(${abs(machine.secretsFile)})`,
				`Edit(${abs(machine.secretsFile)})`,
				"Read(//proc/**)",
				...CONFIG_NAMES.map((n) => `Edit(${n})`),
				...DENIED_TOOLS,
				...FILE_WRITE_TOOLS,
				...CHAT_AGENT_DENIED_TOOLS.map(mcpTool),
			],
		},
		disableClaudeAiConnectors: true,
		autoMemoryEnabled: false,
		claudeMdExcludes: [`${machine.home}/.claude/CLAUDE.md`],
		hooks: {
			PreToolUse: [
				{
					matcher: GUARD_MATCHER,
					hooks: [
						{
							type: "command",
							command: [
								machine.nodeBin,
								`${machine.repoRoot}/server/src/agent-guard.ts`,
								machine.launchDir,
							]
								.map(quote)
								.join(" "),
						},
					],
				},
			],
		},
	};
	const env = { FCC_CHAT_AGENT: "1", FCC_PROJECTS: id };
	const mcpConfig = {
		mcpServers: {
			[AGENT_SERVER]: {
				type: "stdio",
				command: machine.nodeBin,
				args: [`${machine.repoRoot}/server/src/main.ts`],
				env: { FCC_PROJECTS: id, FCC_CHAT_AGENT: "1" },
			},
		},
	};
	const args = [
		"--restricted",
		"--settings",
		`${machine.launchDir}/${SETTINGS_FILE}`,
		"--mcp-config",
		`${machine.launchDir}/${MCP_CONFIG_FILE}`,
		"--strict-mcp-config",
		"--tools",
		AGENT_TOOLS.join(","),
		"--permission-mode",
		"default",
		...readable.flatMap((r) => ["--add-dir", r]),
		"--disable-slash-commands",
		"--no-chrome",
		"--dangerously-load-development-channels",
		`server:${AGENT_SERVER}`,
	];
	return {
		settings,
		mcpConfig,
		args,
		cwd: projectDir,
		env,
		guard: {
			repoRoot: machine.repoRoot,
			roots: [projectDir, ...readable],
			denied: [
				repoEnv,
				machineTokens,
				projectTokens,
				...dbFiles,
				machine.secretsFile,
				...SECRET_HOME_DIRS.map((d) => `${machine.home}/${d}`),
				"/proc",
			],
		},
	};
}

// El entorno de `claude`: la lista blanca de quien lanza (nada del .env) más lo propio del lanzamiento
export function agentEnvironment(
	inherited: Readonly<Record<string, string | undefined>>,
	extra: Readonly<Record<string, string>>,
): Record<string, string> {
	const allowed: readonly string[] = AGENT_ENV_WHITELIST;
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(inherited)) {
		if (value === undefined) continue;
		if (allowed.includes(key) || key.startsWith(LOCALE_PREFIX))
			env[key] = value;
	}
	return { ...env, ...extra };
}
