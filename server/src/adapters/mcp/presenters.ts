import type { StatusReport } from "#application/get-status.ts";
import type { MetadataNode } from "#application/ports/figma-gateway.ts";
import type { DesignContextFile } from "#application/read-design-context.ts";
import type { BuildOutcome } from "#application/run-build.ts";
import type { ReadRun } from "#application/run-read.ts";
import type { ScreenshotFile } from "#application/take-screenshot.ts";
import { BUILD_STATUS, type BuildStep } from "#domain/build.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { JOB_KIND, JOB_STATUS, type Job, type JobId } from "#domain/job.ts";
import type { Result } from "#domain/result.ts";
import type { RunOutcome } from "#domain/run-outcome.ts";
import type {
	designContextOutputShape,
	readOutputShape,
} from "./read-schemas.ts";
import type {
	buildOutputShape,
	cancelOutputShape,
	getJobOutputShape,
	metadataOutputShape,
	OutputOf,
	runOutputShape,
	screenshotOutputShape,
	statusOutputShape,
} from "./schemas.ts";

type RunOutput = OutputOf<typeof runOutputShape>;
// `touchedPath` lo pone limitTouched al responder (lista de ids larga a fichero), no el presenter
type BuildOutput = Omit<OutputOf<typeof buildOutputShape>, "touchedPath">;
type CancelOutput = Omit<OutputOf<typeof cancelOutputShape>, "touchedPath">;
type GetJobOutput = OutputOf<typeof getJobOutputShape>;
type StatusOutput = OutputOf<typeof statusOutputShape>;
type ScreenshotOutput = OutputOf<typeof screenshotOutputShape>;
type MetadataOutput = OutputOf<typeof metadataOutputShape>;
type ReadOutput = OutputOf<typeof readOutputShape>;
type DesignContextOutput = OutputOf<typeof designContextOutputShape>;

export type ToolReply = {
	[key: string]: unknown;
	content: { type: "text"; text: string }[];
	structuredContent?: Record<string, unknown>;
	isError: boolean;
};

// Con outputSchema, la especificación de MCP pide structuredContent y el mismo JSON como texto
export const reply = (
	structured: Record<string, unknown>,
	isError: boolean,
): ToolReply => ({
	content: [{ type: "text", text: JSON.stringify(structured) }],
	structuredContent: structured,
	isError,
});

// Error de uso (entrada inválida, job desconocido): sin structuredContent, solo texto
export const usageError = (message: string): ToolReply => ({
	content: [{ type: "text", text: message }],
	isError: true,
});

export const runningOutput = (jobId: JobId): RunOutput => ({
	status: JOB_STATUS.running,
	jobId,
	ok: true,
	result: null,
	error: null,
	touchedNodeIds: [],
	retryable: false,
});

export const outcomeOutput = (
	outcome: RunOutcome,
	jobId: JobId | null,
): RunOutput => ({
	status: outcome.ok ? JOB_STATUS.done : JOB_STATUS.failed,
	jobId,
	ok: outcome.ok,
	result: outcome.result,
	error: outcome.error,
	touchedNodeIds: outcome.touchedNodeIds,
	retryable: outcome.retryable,
	...(outcome.ok &&
		outcome.warning !== undefined && { warning: outcome.warning }),
});

// Un paso en la respuesta: sus campos y el aviso; el resultado de cada paso queda en el histórico
const stepOutput = (step: BuildStep): BuildOutput["steps"][number] => ({
	index: step.index,
	file: step.file,
	status: step.status,
	ms: step.ms,
	touchedCount: step.touchedCount,
	error: step.error,
	warning: step.warning,
});

// Contrato de resultado de un lote, aplanado para figma_build
export const buildOutput = (
	outcome: BuildOutcome,
	jobId: JobId | null,
): BuildOutput => ({
	ok: outcome.ok,
	status: outcome.status,
	jobId,
	result: null,
	error: outcome.error,
	touchedNodeIds: outcome.touchedNodeIds,
	retryable: outcome.retryable,
	progress: outcome.progress,
	steps: outcome.steps.map(stepOutput),
});

// Salida de figma_cancel_job cuando el lote se para
export const cancelOutput = (
	outcome: BuildOutcome,
	jobId: JobId,
): CancelOutput => ({
	ok: outcome.ok,
	status: outcome.status,
	cancelRequested: false,
	jobId,
	progress: outcome.progress,
	steps: outcome.steps.map(stepOutput),
	touchedNodeIds: outcome.touchedNodeIds,
	error: outcome.error,
});

// Salida de figma_cancel_job cuando el lote aún no ha acabado: el progreso y los pasos son los de ahora mismo
export const cancelRequestedOutput = (
	outcome: BuildOutcome,
	jobId: JobId,
): CancelOutput => ({
	...cancelOutput(outcome, jobId),
	cancelRequested: true,
});

type BuildJob = Extract<Job, { readonly kind: typeof JOB_KIND.build }>;

const buildJobOutcome = (job: BuildJob): BuildOutcome =>
	job.status === JOB_STATUS.running
		? {
				ok: true,
				status: BUILD_STATUS.running,
				error: null,
				touchedNodeIds: [],
				retryable: false,
				progress: job.progress,
				steps: job.steps,
			}
		: {
				ok: job.outcome.ok,
				status: job.status,
				error: job.outcome.error,
				touchedNodeIds: job.outcome.touchedNodeIds,
				retryable: job.outcome.retryable,
				progress: job.progress,
				steps: job.steps,
			};

export const jobOutput = (job: Job): GetJobOutput => {
	if ("kind" in job && job.kind === JOB_KIND.build) {
		return {
			...buildOutput(buildJobOutcome(job), job.id),
			kind: JOB_KIND.build,
		};
	}
	return job.status === JOB_STATUS.running
		? runningOutput(job.id)
		: outcomeOutput(job.outcome, job.id);
};

const PREVIOUS_SCRIPT_NEXT_STEP =
	"Un script anterior venció su plazo y sigue ejecutándose en la pestaña: espera a que termine o recarga la pestaña de Figma; hasta entonces las escrituras se rechazan.";

export const statusOutput = (s: StatusReport): StatusOutput => ({
	ok: s.error === null,
	chromeReachable: s.chromeReachable,
	tabFound: s.tabFound,
	figmaReady: s.figmaReady,
	fileName: s.fileName,
	pageName: s.pageName,
	error: s.error,
	retryable: s.error?.retryable ?? false,
	previousScriptRunning: s.previousScriptRunning,
	nextStep:
		s.error?.nextStep ??
		(s.previousScriptRunning ? PREVIOUS_SCRIPT_NEXT_STEP : null),
});

const failure = (error: FigmaError) => ({
	ok: false,
	error,
	retryable: error.retryable,
});

export const screenshotOutput = (
	r: Result<ScreenshotFile, FigmaError>,
): ScreenshotOutput =>
	r.ok
		? { ok: true, ...r.value, error: null, retryable: false }
		: {
				...failure(r.error),
				path: null,
				bytes: null,
				width: null,
				height: null,
			};

export const metadataOutput = (
	r: Result<MetadataNode, FigmaError>,
): MetadataOutput =>
	r.ok
		? { ok: true, tree: r.value, error: null, retryable: false }
		: { ...failure(r.error), tree: null };

// Salida común de las lecturas del catálogo: nunca tocan nodos
export const readOutput = (
	run: Exclude<ReadRun, { readonly kind: "usage" }>,
): ReadOutput => {
	const none = { touchedNodeIds: [] } as const;
	if (run.kind === "running") {
		return {
			ok: true,
			status: JOB_STATUS.running,
			jobId: run.jobId,
			path: null,
			summary: null,
			error: null,
			retryable: false,
			...none,
		};
	}
	const { outcome, jobId } = run;
	return outcome.ok
		? {
				ok: true,
				status: JOB_STATUS.done,
				jobId,
				path: outcome.value.path,
				summary: outcome.value.summary,
				error: null,
				retryable: false,
				...none,
			}
		: {
				ok: false,
				status: JOB_STATUS.failed,
				jobId,
				path: null,
				summary: null,
				error: outcome.error,
				retryable: outcome.error.retryable,
				...none,
			};
};

// Salida de figma_design_context: la común de las lecturas y, si terminó bien, lo que trae su lectura además de la ruta
export const designContextOutput = (
	run: Exclude<ReadRun<DesignContextFile>, { readonly kind: "usage" }>,
): DesignContextOutput => {
	const common = readOutput(run);
	if (run.kind === "finished" && run.outcome.ok) {
		const { screenshotPath, warnings, unmapped, truncated } = run.outcome.value;
		return { ...common, screenshotPath, warnings, unmapped, truncated };
	}
	return {
		...common,
		screenshotPath: null,
		warnings: [],
		unmapped: [],
		truncated: null,
	};
};
