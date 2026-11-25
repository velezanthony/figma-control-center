// Contrato del histórico consultable: lo comparten las herramientas MCP, la API HTTP y la web (solo con
// `import type`). Sin imports, como activity.ts, para poder mudarlo tal cual a un paquete de contratos.

export type CallStatus = "running" | "ok" | "error";
export type JobStatus = "running" | "done" | "failed" | "cancelled";

export type HistoryError = {
	readonly type: string;
	readonly message: string;
	readonly nextStep: string | null;
	readonly line: number | null;
};

export type JobInfo = {
	readonly status: JobStatus;
	readonly ms: number | null;
	readonly error: HistoryError | null;
	readonly touchedNodeIds: readonly string[];
};

export type ScreenshotInfo = {
	readonly nodeId: string;
	readonly path: string;
	readonly width: number;
	readonly height: number;
};

// Estado de un paso de un lote (espejo de STEP_STATUS en domain/build.ts; aquí sin import, como JobStatus)
export type BuildStepStatus =
	| "pending"
	| "running"
	| "done"
	| "failed"
	| "skipped"
	| "cancelled";

// Lo que devolvió un paso tal como se guardó: su valor ya leído si cupo en el tope de M1, o dónde se volcó si no
export type BuildStepFullResult =
	| { readonly kind: "inline"; readonly value: unknown }
	| { readonly kind: "file"; readonly path: string; readonly bytes: number };

// Lo que ve quien consulta el histórico de un paso: un extracto corto (el JSON compacto cortado al tope, con lo que
// ocupa entero y si se recortó) o, si el resultado fue a fichero, su ruta. El resultado entero se pide aparte, por paso.
export type BuildStepResultItem =
	| {
			readonly kind: "inline";
			readonly excerpt: string;
			readonly bytes: number;
			readonly truncated: boolean;
	  }
	| { readonly kind: "file"; readonly path: string; readonly bytes: number };

// Un paso de un lote tal como se ve en el histórico (figma_history_call y la página Jobs)
export type BuildStepItem = {
	readonly index: number;
	readonly file: string;
	readonly status: BuildStepStatus;
	readonly ms: number | null;
	readonly touchedCount: number;
	readonly error: HistoryError | null;
	readonly warning: string | null;
	// null: no devolvió nada, no llegó a correr o es de un lote anterior a guardar resultados
	readonly result: BuildStepResultItem | null;
};

// El paso como lo entrega el almacén: con el resultado entero (History lo recorta o lo da aparte)
export type StoredBuildStep = Omit<BuildStepItem, "result"> & {
	readonly result: BuildStepFullResult | null;
};

export type CallItem = {
	readonly callId: string;
	readonly sessionId: string;
	// Archivo de Figma de la sesión que la hizo (para enlazar a sus nodos)
	readonly fileUrl: string | null;
	readonly tool: string;
	// ISO 8601 UTC
	readonly startedAt: string;
	readonly args: Readonly<Record<string, string | number | boolean | null>>;
	readonly status: CallStatus;
	readonly ms: number | null;
	readonly retryable: boolean | null;
	readonly touchedNodeIds: readonly string[];
	readonly error: HistoryError | null;
	readonly resultPath: string | null;
	readonly jobId: string | null;
	readonly job: JobInfo | null;
	readonly screenshots: readonly ScreenshotInfo[];
	// Frase corta generada al registrar: lo que se indexa y lo que ve primero un agente
	readonly summary: string;
};

export type SessionItem = {
	readonly sessionId: string;
	readonly pid: number | null;
	readonly fileUrl: string | null;
	readonly startedAt: string;
	readonly lastSeenAt: string;
	readonly calls: number;
	readonly writes: number;
	readonly errors: number;
	readonly totalMs: number;
};

export type ToolStat = {
	readonly tool: string;
	readonly calls: number;
	readonly errors: number;
};

export type ErrorExample = {
	readonly callId: string;
	readonly tool: string;
	readonly at: string;
	readonly message: string;
};

export type ErrorGroup = {
	readonly type: string;
	readonly count: number;
	readonly lastAt: string;
	readonly nextStep: string | null;
	readonly examples: readonly ErrorExample[];
};

export type NodeTouch = {
	readonly nodeId: string;
	// Llamadas distintas que lo tocaron dentro del rango
	readonly touches: number;
	readonly lastAt: string;
	readonly lastCallId: string;
	readonly lastTool: string;
};

export type ConnectionStatus = {
	readonly at: string;
	readonly chromeReachable: boolean;
	readonly tabFound: boolean;
	readonly figmaReady: boolean;
	readonly fileName: string | null;
	readonly pageName: string | null;
};

export type CaptureItem = {
	readonly call: CallItem;
	readonly shot: ScreenshotInfo;
};

// Toda lista consultable dice cuántas hay en total y si se cortó por el tope
export type Page<T> = {
	readonly items: readonly T[];
	readonly total: number;
	readonly truncated: boolean;
};

// Los campos admiten undefined: así se pasan tal cual los que llegan de un esquema opcional
export type RangeInput = {
	readonly preset?: "last_hour" | "today" | undefined;
	// ISO 8601
	readonly since?: string | undefined;
	readonly until?: string | undefined;
	readonly sessionId?: string | undefined;
};

// El rango ya resuelto: epoch ms UTC (null = sin límite) y sesión opcional
export type ResolvedRange = {
	readonly fromMs: number | null;
	readonly toMs: number | null;
	readonly sessionId: string | null;
};

export type HistorySummary = {
	readonly range: ResolvedRange;
	readonly calls: number;
	readonly writes: number;
	readonly errors: number;
	readonly running: number;
	readonly meanMs: number | null;
	readonly p95Ms: number | null;
	readonly jobs: number;
	readonly nodesTouched: number;
	readonly topTools: readonly ToolStat[];
};

export type SortKey =
	| "time"
	| "tool"
	| "status"
	| "duration"
	| "nodes"
	| "session";
export type SortDir = "asc" | "desc";
export type StatusFilter = "all" | "ok" | "error" | "running";

export type CallsQuery = {
	readonly range: ResolvedRange;
	readonly tool: string | null;
	readonly status: StatusFilter;
	// Texto libre (FTS5): ruta, herramienta, texto de error o id de nodo
	readonly search: string;
	// Solo llamadas que lanzaron un job (los que siguen en curso, primero)
	readonly jobsOnly: boolean;
	readonly sort: { readonly key: SortKey; readonly dir: SortDir };
	readonly page: number;
	readonly perPage: number;
	// Id de una llamada: la página devuelta es la que la contiene con estos filtros y orden
	readonly locate: string | null;
};

export type CallsPage = Page<CallItem> & {
	readonly page: number;
	readonly perPage: number;
};
