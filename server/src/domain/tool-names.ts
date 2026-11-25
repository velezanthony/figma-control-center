import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";

// Nombres de las herramientas MCP: vocabulario compartido (el histórico clasifica las llamadas por ellos)
export const TOOL_NAME = Object.freeze({
	runScript: "figma_run_script",
	build: "figma_build",
	cancelJob: "figma_cancel_job",
	getJob: "figma_get_job",
	status: "figma_status",
	screenshot: "figma_screenshot",
	metadata: "figma_metadata",
	// Lecturas del catálogo (M3): solo lectura, fuera de WRITE_TOOLS
	variables: "figma_variables",
	styles: "figma_styles",
	components: "figma_components",
	instances: "figma_instances",
	export: "figma_export",
	// Diseño a código: solo lectura, fuera de WRITE_TOOLS
	designContext: "figma_design_context",
	historySummary: "figma_history_summary",
	historyErrors: "figma_history_errors",
	historyNodes: "figma_history_nodes",
	historySessions: "figma_history_sessions",
	historySearch: "figma_history_search",
	historyCall: "figma_history_call",
	// Historial de intentos (F2): solo lectura; el contenido de un intento se vuelca a la carpeta de salida
	historyAttempts: "figma_history_attempts",
	historyScript: "figma_history_script",
	historyDiff: "figma_history_diff",
	chatReply: "figma_chat_reply",
	// Captura de la web (F1): no toca Figma, así que va fuera de WRITE_TOOLS; el agente del chat no la usa
	capture: "figma_capture",
} as const);

// Las que modifican el archivo de Figma (figma_cancel_job para un lote)
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
	TOOL_NAME.runScript,
	TOOL_NAME.build,
	TOOL_NAME.cancelJob,
]);

export const isWriteTool = (tool: string): boolean => WRITE_TOOLS.has(tool);

// Lo que el agente del chat del panel nunca usa: solo consulta; pintar, construir y capturar se hace desde Claude Code
// en el proyecto. Lo niegan su arnés, su guardián y el propio servidor
export const CHAT_AGENT_DENIED_TOOLS: readonly string[] = [
	TOOL_NAME.runScript,
	TOOL_NAME.build,
	TOOL_NAME.cancelJob,
	TOOL_NAME.capture,
];

// Fallos que llegan después de enviar el script a la pestaña: algo pudo ejecutarse. Los demás
// (ruta, sin sesión, Chrome…) se quedan antes de tocar Figma
export const RAN_IN_TAB_ERROR_TYPES: readonly string[] = [
	FIGMA_ERROR_TYPE.scriptError,
	FIGMA_ERROR_TYPE.timeout,
];

// `writes` cuenta las llamadas que ejecutaron algo en la pestaña; figma_cancel_job no ejecuta scripts
export const ranInTab = (
	tool: string,
	ok: boolean,
	errorType: string | null,
): boolean =>
	isWriteTool(tool) &&
	tool !== TOOL_NAME.cancelJob &&
	(ok || (errorType !== null && RAN_IN_TAB_ERROR_TYPES.includes(errorType)));
