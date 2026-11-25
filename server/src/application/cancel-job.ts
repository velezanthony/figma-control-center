import { BUILD_STATUS } from "#domain/build.ts";
import { JOB_KIND, JOB_STATUS, type Job, type JobId } from "#domain/job.ts";
import type { JobRegistry } from "./job-registry.ts";
import type { BuildOutcome } from "./run-build.ts";

const CANNOT_INTERRUPT =
	"Figma no permite interrumpir un script en marcha; trocéalo en pasos con figma_build";

export type CancelJobInput = { readonly jobId: JobId };

export type CancelJobResult =
	| {
			readonly kind: "finished";
			readonly jobId: JobId;
			readonly outcome: BuildOutcome;
	  }
	| {
			readonly kind: "cancelRequested";
			readonly jobId: JobId;
			readonly outcome: BuildOutcome;
	  }
	| { readonly kind: "usage"; readonly message: string };

export type CancelJobDeps = { readonly jobs: JobRegistry };

// Un lote (único job cancelable) se observa siempre con progreso y pasos; de ahí se arma su vista uniforme.
const isBuild = (
	job: Job,
): job is Extract<Job, { readonly kind: typeof JOB_KIND.build }> =>
	"kind" in job && job.kind === JOB_KIND.build;

const buildOutcomeOf = (
	job: Extract<Job, { readonly kind: typeof JOB_KIND.build }>,
): BuildOutcome =>
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

export function makeCancelJob(deps: CancelJobDeps) {
	return async (input: CancelJobInput): Promise<CancelJobResult> => {
		const job = deps.jobs.get(input.jobId);
		if (job === undefined) {
			return {
				kind: "usage",
				message: `No existe el job ${input.jobId} (nunca se creó o el servidor se reinició).`,
			};
		}
		// Solo un lote se puede cancelar: un figma_run_script en marcha no.
		if (!isBuild(job)) {
			return { kind: "usage", message: CANNOT_INTERRUPT };
		}
		// Un lote ya terminado: se devuelve su estado final tal cual (idempotente).
		if (job.status !== JOB_STATUS.running) {
			return {
				kind: "finished",
				jobId: input.jobId,
				outcome: buildOutcomeOf(job),
			};
		}

		// Responde enseguida: el paso en curso acaba solo (Figma no deja interrumpir un script) y el estado final
		// se ve con figma_get_job (waitMs). La respuesta lleva lo que ya está hecho.
		deps.jobs.requestCancel(input.jobId);
		return {
			kind: "cancelRequested",
			jobId: input.jobId,
			outcome: buildOutcomeOf(job),
		};
	};
}
