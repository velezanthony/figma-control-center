// Contrato de los eventos de actividad. Fuente única de verdad: sin imports, para que el servidor
// y la web (solo con `import type`) lo compartan y pueda mudarse tal cual a un paquete de contratos.

export const ACTIVITY_VERSION = 1;

export const ACTIVITY_TYPE = Object.freeze({
	sessionStarted: "session_started",
	toolCalled: "tool_called",
	toolFinished: "tool_finished",
	jobFinished: "job_finished",
	buildStepFinished: "build_step_finished",
	screenshotSaved: "screenshot_saved",
	statusChecked: "status_checked",
} as const);

// Errores que no vienen de Figma (los de Figma usan su `FigmaErrorType`). `Interrupted` es el de un job que se
// cerró porque su proceso desapareció.
export const ACTIVITY_ERROR = Object.freeze({
	usage: "UsageError",
	unexpected: "UnexpectedError",
	interrupted: "Interrupted",
} as const);

type Base = {
	readonly v: typeof ACTIVITY_VERSION;
	readonly at: string;
	readonly sessionId: string;
};

export type ArgValue = string | number | boolean | null;
export type ArgsSummary = Readonly<Record<string, ArgValue>>;

export type ActivityError = {
	readonly type: string;
	readonly message: string;
	readonly nextStep: string | null;
	readonly line: number | null;
};

export type SessionStarted = Base & {
	readonly type: typeof ACTIVITY_TYPE.sessionStarted;
	readonly pid: number;
	readonly fileUrl: string;
};

export type ToolCalled = Base & {
	readonly type: typeof ACTIVITY_TYPE.toolCalled;
	readonly callId: string;
	readonly tool: string;
	readonly args: ArgsSummary;
};

export type ToolFinished = Base & {
	readonly type: typeof ACTIVITY_TYPE.toolFinished;
	readonly callId: string;
	readonly ok: boolean;
	readonly ms: number;
	readonly retryable?: boolean;
	readonly touchedNodeIds: readonly string[];
	readonly error?: ActivityError;
	readonly resultPath?: string;
	readonly jobId?: string;
};

export type JobFinished = Base & {
	readonly type: typeof ACTIVITY_TYPE.jobFinished;
	readonly jobId: string;
	readonly ok: boolean;
	readonly ms: number;
	readonly touchedNodeIds: readonly string[];
	readonly error?: ActivityError;
	// Estado final de un lote (`cancelled` es `ok:true`); un job de script lo omite y su estado sale de `ok`.
	readonly status?: "done" | "failed" | "cancelled";
};

// El estado de un paso de un lote cada vez que cambia (el plan entero al empezar, `running`, y su final). Alimenta la
// tabla `build_steps` y la página Jobs del panel; el nombre es el del evento ya escrito en los jsonl.
export type BuildStepFinished = Base & {
	readonly type: typeof ACTIVITY_TYPE.buildStepFinished;
	readonly jobId: string;
	readonly index: number;
	readonly file: string;
	readonly status:
		| "pending"
		| "running"
		| "done"
		| "failed"
		| "skipped"
		| "cancelled";
	readonly ms: number | null;
	readonly touchedCount: number;
	readonly error?: ActivityError;
	readonly warning?: string;
	// Lo que devolvió el paso: su JSON en línea o el fichero donde se volcó por pasar del tope. Sin clave si no hay.
	readonly result?:
		| { readonly kind: "inline"; readonly json: string }
		| {
				readonly kind: "file";
				readonly path: string;
				readonly bytes: number;
		  };
};

export type ScreenshotSaved = Base & {
	readonly type: typeof ACTIVITY_TYPE.screenshotSaved;
	readonly callId: string;
	readonly nodeId: string;
	readonly path: string;
	readonly width: number;
	readonly height: number;
};

export type StatusChecked = Base & {
	readonly type: typeof ACTIVITY_TYPE.statusChecked;
	readonly chromeReachable: boolean;
	readonly tabFound: boolean;
	readonly figmaReady: boolean;
	readonly fileName: string | null;
	readonly pageName: string | null;
};

export type ActivityEvent =
	| SessionStarted
	| ToolCalled
	| ToolFinished
	| JobFinished
	| BuildStepFinished
	| ScreenshotSaved
	| StatusChecked;

export type ActivityEventType = ActivityEvent["type"];

const KNOWN_TYPES: ReadonlySet<string> = new Set(Object.values(ACTIVITY_TYPE));

// Comprobación de la cabecera: los eventos los escribe este mismo programa, así que el resto de campos se da por bueno
export function isActivityEvent(value: unknown): value is ActivityEvent {
	if (typeof value !== "object" || value === null) return false;
	const e = value as Record<string, unknown>;
	return (
		e["v"] === ACTIVITY_VERSION &&
		typeof e["at"] === "string" &&
		typeof e["sessionId"] === "string" &&
		typeof e["type"] === "string" &&
		KNOWN_TYPES.has(e["type"])
	);
}
