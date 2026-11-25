import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	type ActivityError,
	type ActivityEvent,
	type ArgsSummary,
	type BuildStepFinished,
} from "#domain/activity.ts";

// Constructores de eventos para los tests: la cabecera común y un reloj en ms desde una fecha base
export const T0 = Date.parse("2026-06-01T10:00:00.000Z");
export const at = (offsetMs: number): string =>
	new Date(T0 + offsetMs).toISOString();

const head = (sessionId: string, offsetMs: number) =>
	({
		v: ACTIVITY_VERSION,
		at: at(offsetMs),
		sessionId,
	}) as const;

export const sessionStarted = (
	sessionId: string,
	offsetMs = 0,
	fileUrl = "https://www.figma.com/design/abc/Archivo",
): ActivityEvent => ({
	...head(sessionId, offsetMs),
	type: ACTIVITY_TYPE.sessionStarted,
	pid: 4242,
	fileUrl,
});

export const toolCalled = (
	sessionId: string,
	callId: string,
	tool: string,
	args: ArgsSummary,
	offsetMs: number,
): ActivityEvent => ({
	...head(sessionId, offsetMs),
	type: ACTIVITY_TYPE.toolCalled,
	callId,
	tool,
	args,
});

export const toolFinished = (
	sessionId: string,
	callId: string,
	offsetMs: number,
	rest: {
		readonly ok?: boolean;
		readonly ms?: number;
		readonly touchedNodeIds?: readonly string[];
		readonly error?: ActivityError;
		readonly jobId?: string;
		readonly resultPath?: string;
		readonly retryable?: boolean;
	} = {},
): ActivityEvent => ({
	...head(sessionId, offsetMs),
	type: ACTIVITY_TYPE.toolFinished,
	callId,
	ok: rest.ok ?? true,
	ms: rest.ms ?? 100,
	touchedNodeIds: rest.touchedNodeIds ?? [],
	...(rest.error !== undefined && { error: rest.error }),
	...(rest.jobId !== undefined && { jobId: rest.jobId }),
	...(rest.resultPath !== undefined && { resultPath: rest.resultPath }),
	...(rest.retryable !== undefined && { retryable: rest.retryable }),
});

export const jobFinished = (
	sessionId: string,
	jobId: string,
	offsetMs: number,
	rest: {
		readonly ok?: boolean;
		readonly ms?: number;
		readonly touchedNodeIds?: readonly string[];
		readonly error?: ActivityError;
		readonly status?: "done" | "failed" | "cancelled";
	} = {},
): ActivityEvent => ({
	...head(sessionId, offsetMs),
	type: ACTIVITY_TYPE.jobFinished,
	jobId,
	ok: rest.ok ?? true,
	ms: rest.ms ?? 5000,
	touchedNodeIds: rest.touchedNodeIds ?? [],
	...(rest.error !== undefined && { error: rest.error }),
	...(rest.status !== undefined && { status: rest.status }),
});

export const buildStepFinished = (
	sessionId: string,
	jobId: string,
	offsetMs: number,
	rest: {
		readonly index?: number;
		readonly file?: string;
		readonly status?: BuildStepFinished["status"];
		readonly ms?: number | null;
		readonly touchedCount?: number;
		readonly error?: ActivityError;
		readonly warning?: string;
		readonly result?: BuildStepFinished["result"];
	} = {},
): ActivityEvent => ({
	...head(sessionId, offsetMs),
	type: ACTIVITY_TYPE.buildStepFinished,
	jobId,
	index: rest.index ?? 0,
	file: rest.file ?? "build_x.js",
	status: rest.status ?? "done",
	ms: rest.ms ?? 100,
	touchedCount: rest.touchedCount ?? 0,
	...(rest.error !== undefined && { error: rest.error }),
	...(rest.warning !== undefined && { warning: rest.warning }),
	...(rest.result !== undefined && { result: rest.result }),
});

export const screenshotSaved = (
	sessionId: string,
	callId: string,
	offsetMs: number,
	nodeId = "1:23",
	path = "/tmp/out/shot-1.png",
): ActivityEvent => ({
	...head(sessionId, offsetMs),
	type: ACTIVITY_TYPE.screenshotSaved,
	callId,
	nodeId,
	path,
	width: 800,
	height: 600,
});

export const statusChecked = (
	sessionId: string,
	offsetMs: number,
): ActivityEvent => ({
	...head(sessionId, offsetMs),
	type: ACTIVITY_TYPE.statusChecked,
	chromeReachable: true,
	tabFound: true,
	figmaReady: true,
	fileName: "Archivo",
	pageName: "Página 1",
});

export const scriptError = (message = "Unexpected token"): ActivityError => ({
	type: "ScriptError",
	message,
	nextStep: "Corrige el script y vuelve a ejecutarlo.",
	line: 3,
});
