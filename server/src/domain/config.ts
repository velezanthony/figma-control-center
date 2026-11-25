// Config en dos capas. Tipos puros: solo importa tipos del propio dominio.
//
// MachineConfig: lo compartido por la máquina (del .env del servidor). Una vez.
// TenantConfig: lo propio de cada proyecto (del registro). Hereda la máquina y
// sobrescribe solo lo suyo. La config efectiva de un tenant = MachineConfig ⊕ TenantConfig.
import type { DashboardMode } from "./settings.ts";

// Alcance de acceso que declara el MCP al conectar (FCC_PROJECTS): todos o unos ids.
export type ProjectScope =
	| { readonly kind: "any" }
	| { readonly kind: "ids"; readonly ids: readonly string[] };

// Campos propios de un proyecto. Lo que hoy son FIGMA_FILE_URL, FCC_SCRIPTS_ROOT,
// FCC_DB_PATH, FCC_OUTPUT_DIR y FCC_ACTIVITY_FILE pasa a ser fila del registro.
export type TenantConfig = {
	readonly id: string;
	readonly name: string;
	readonly fileUrl: string;
	// La carpeta del proyecto (de su fila del registro): ahí vive su figma-control-center.json (captura de la web, D-4)
	readonly projectDir: string;
	readonly scriptsRoots: readonly string[];
	readonly outputDir: string;
	readonly activityFile: string;
};

// Config de máquina: todo lo que no es de un proyecto concreto.
export type MachineConfig = {
	readonly cdp: {
		readonly host: string;
		readonly port: number;
		readonly callTimeoutMs: number;
	};
	readonly chrome: {
		readonly profile: string;
		readonly seedProfile: string | null;
	};
	readonly figma: {
		readonly testFileUrl: string | null;
		readonly readyTimeoutMs: number;
	};
	// Raíz contra la que se resuelven las rutas relativas de los scripts (la raíz del repo)
	readonly scriptsBaseDir: string;
	readonly output: { readonly maxInlineResultBytes: number };
	readonly jobs: { readonly softDeadlineMs: number };
	readonly activity: { readonly codePreviewChars: number };
	readonly dashboard: {
		readonly host: string;
		readonly port: number;
		readonly historyEvents: number;
		readonly mode: DashboardMode;
	};
	readonly history: {
		readonly retentionDays: number;
		readonly maxRows: number;
		readonly stepExcerptBytes: number;
		// Tope de un script guardado en el historial de intentos (más: solo su hash y tamaño)
		readonly scriptMaxBytes: number;
		// Líneas de diff que figma_history_diff devuelve en la respuesta
		readonly diffInlineLines: number;
	};
	readonly live: { readonly pollMs: number };
	readonly chat: { readonly pollMs: number; readonly agent: boolean };
	readonly agent: {
		readonly terminal: readonly string[];
		readonly launchTimeoutMs: number;
		// Cuánto espera agent-run.ts a que vuelva el panel y cada cuánto reintenta conectar
		readonly panelGraceMs: number;
		readonly watchRetryMs: number;
		// El `claude` que arranca agent-run.ts (null: el del PATH); solo lo fijan los tests
		readonly claudeBin: string | null;
		// Entorno de pruebas: agent-run.ts solo arranca el `claude` falso
		readonly testHarness: boolean;
	};
	readonly build: {
		readonly maxSteps: number;
		readonly stepTimeoutMs: number;
		readonly progressMinIntervalMs: number;
		readonly maxParamsBytes: number;
		readonly maxAssetBytes: number;
	};
	// Lecturas del catálogo (M3): nodos por llamada a figma_export
	readonly read: {
		readonly exportMaxNodes: number;
		readonly designContextMaxNodes: number;
	};
	readonly e2e: { readonly enabled: boolean };
	// Captura de la web (F1): el Chrome de captura aparte (binario, puerto, dónde van sus perfiles temporales), el
	// fichero de secretos de la máquina y los topes de una captura
	readonly web: {
		readonly chromeBin: string;
		readonly chromePort: number;
		readonly profileDir: string;
		readonly secretsFile: string;
		readonly pageTimeoutMs: number;
		readonly captureMaxBytes: number;
		readonly contractInlineErrors: number;
	};
	// Carpeta de máquina con los locks de lote (un fichero por archivo de Figma, con el pid dentro): la comparten
	// todas las sesiones de Claude Code, así que no puede depender de un proyecto ni de FCC_OUTPUT_DIR
	readonly locksDir: string;
	// La base única de la máquina (proyectos, ajustes e histórico): se fija fuera de la base porque sin ella no se abre nada
	readonly dbPath: string;
};
