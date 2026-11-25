import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	type ActivityError,
	type ActivityEvent,
} from "#domain/activity.ts";
import type { BuildStatus, BuildStep } from "#domain/build.ts";
import { FIGMA_ERROR_TYPE, type FigmaError } from "#domain/figma-error.ts";
import type { JobId } from "#domain/job.ts";
import type { RunOutcome } from "#domain/run-outcome.ts";
import { summarizeToolArgs } from "#domain/summarize-args.ts";
import type { ActivityLog } from "./ports/activity-log.ts";
import type { FigmaStatus } from "./ports/figma-gateway.ts";

export const MAX_ERROR_CHARS = 1000;

export function activityErrorOf(error: FigmaError): ActivityError {
	return {
		type: error.type,
		message: error.message.slice(0, MAX_ERROR_CHARS),
		nextStep: error.nextStep,
		line: error.type === FIGMA_ERROR_TYPE.scriptError ? error.line : null,
	};
}

export type ToolFinishedInfo = {
	readonly ok: boolean;
	readonly retryable?: boolean;
	readonly touchedNodeIds: readonly string[];
	readonly error?: ActivityError;
	readonly resultPath?: string;
	readonly jobId?: string;
};

export type StatusSnapshot = Pick<
	FigmaStatus,
	"chromeReachable" | "tabFound" | "figmaReady" | "fileName" | "pageName"
>;

export type ActivityCall = {
	readonly callId: string;
	screenshotSaved(info: {
		readonly nodeId: string;
		readonly path: string;
		readonly width: number;
		readonly height: number;
	}): void;
	statusChecked(status: StatusSnapshot): void;
	finished(info: ToolFinishedInfo): void;
};

export type ActivityRecorder = {
	sessionStarted(info: {
		readonly pid: number;
		readonly fileUrl: string;
	}): void;
	startCall(
		tool: string,
		args: Readonly<Record<string, unknown>>,
	): ActivityCall;
	jobFinished(info: {
		readonly jobId: JobId;
		readonly outcome: RunOutcome;
		readonly ms: number;
	}): void;
	// Pasos de un lote cuyo estado acaba de cambiar (`changed`: sus índices): el plan entero al empezar, `running`, finales.
	buildStepsChanged(info: {
		readonly jobId: JobId;
		readonly steps: readonly BuildStep[];
		readonly changed: readonly number[];
	}): void;
	// Un lote que terminó en segundo plano (tras superar el plazo blando): job_finished con su estado final.
	buildFinished(info: {
		readonly jobId: JobId;
		readonly outcome: {
			readonly ok: boolean;
			readonly status: BuildStatus;
			readonly error: FigmaError | null;
			readonly touchedNodeIds: readonly string[];
		};
		readonly ms: number;
	}): void;
};

export type ActivityRecorderDeps = {
	readonly log: ActivityLog;
	readonly sessionId: string;
	readonly codePreviewChars: number;
	readonly now: () => Date;
	// Reloj monótono en ms, para medir duraciones
	readonly elapsedMs: () => number;
	readonly newCallId: () => string;
	readonly warn: (message: string) => void;
};

export function createActivityRecorder(
	deps: ActivityRecorderDeps,
): ActivityRecorder {
	// Registrar es accesorio: ni un fallo de la salida ni un bug al armar el evento rompen la herramienta
	const emit = (build: () => ActivityEventBody): void => {
		try {
			deps.log.record({
				v: ACTIVITY_VERSION,
				at: deps.now().toISOString(),
				sessionId: deps.sessionId,
				...build(),
			} as ActivityEvent);
		} catch (e) {
			deps.warn(
				`actividad: no se pudo registrar el evento: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	};

	return {
		sessionStarted: ({ pid, fileUrl }) =>
			emit(() => ({ type: ACTIVITY_TYPE.sessionStarted, pid, fileUrl })),

		startCall(tool, args) {
			const callId = deps.newCallId();
			const startedAt = deps.elapsedMs();
			emit(() => ({
				type: ACTIVITY_TYPE.toolCalled,
				callId,
				tool,
				args: summarizeToolArgs(args, deps.codePreviewChars),
			}));
			return {
				callId,
				screenshotSaved: (info) =>
					emit(() => ({
						type: ACTIVITY_TYPE.screenshotSaved,
						callId,
						...info,
					})),
				statusChecked: (s) =>
					emit(() => ({
						type: ACTIVITY_TYPE.statusChecked,
						chromeReachable: s.chromeReachable,
						tabFound: s.tabFound,
						figmaReady: s.figmaReady,
						fileName: s.fileName,
						pageName: s.pageName,
					})),
				finished: (info) =>
					emit(() => ({
						type: ACTIVITY_TYPE.toolFinished,
						callId,
						ok: info.ok,
						ms: deps.elapsedMs() - startedAt,
						touchedNodeIds: info.touchedNodeIds,
						...(info.retryable !== undefined && { retryable: info.retryable }),
						...(info.error !== undefined && { error: info.error }),
						...(info.resultPath !== undefined && {
							resultPath: info.resultPath,
						}),
						...(info.jobId !== undefined && { jobId: info.jobId }),
					})),
			};
		},

		jobFinished: ({ jobId, outcome, ms }) =>
			emit(() => ({
				type: ACTIVITY_TYPE.jobFinished,
				jobId,
				ok: outcome.ok,
				ms,
				touchedNodeIds: outcome.touchedNodeIds,
				...(outcome.error !== null && {
					error: activityErrorOf(outcome.error),
				}),
			})),

		buildStepsChanged: ({ jobId, steps, changed }) => {
			for (const index of changed) {
				const step = steps[index];
				if (step === undefined) continue;
				emit(() => ({
					type: ACTIVITY_TYPE.buildStepFinished,
					jobId,
					index: step.index,
					file: step.file,
					status: step.status,
					ms: step.ms,
					touchedCount: step.touchedCount,
					...(step.error !== null && { error: activityErrorOf(step.error) }),
					...(step.warning !== null && { warning: step.warning }),
					...(step.result !== null && { result: step.result }),
				}));
			}
		},

		buildFinished: ({ jobId, outcome, ms }) =>
			emit(() => ({
				type: ACTIVITY_TYPE.jobFinished,
				jobId,
				ok: outcome.ok,
				ms,
				touchedNodeIds: outcome.touchedNodeIds,
				status: outcome.status as "done" | "failed" | "cancelled",
				...(outcome.error !== null && {
					error: activityErrorOf(outcome.error),
				}),
			})),
	};
}

// El cuerpo de un evento: todo menos la cabecera que añade `emit`
type ActivityEventBody = ActivityEvent extends infer E
	? E extends ActivityEvent
		? Omit<E, "v" | "at" | "sessionId">
		: never
	: never;
