import type { BuildStep, Progress } from "./build.ts";
import type { RunOutcome } from "./run-outcome.ts";

export type JobId = string & { readonly __brand: "JobId" };

// Único punto donde se afirma la marca: el id viene de fuera (UUID o parámetro de herramienta)
export const toJobId = (raw: string): JobId => raw as JobId;

// `cancelled` solo le pasa a un lote: un `figma_run_script` en marcha no se puede interrumpir.
export const JOB_STATUS = Object.freeze({
	running: "running",
	done: "done",
	failed: "failed",
	cancelled: "cancelled",
} as const);
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

// Qué clase de job es. Un job de script no lleva `kind`; un lote se distingue por `kind: "build"`.
export const JOB_KIND = Object.freeze({
	script: "script",
	build: "build",
} as const);
export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

export type Job =
	| { readonly id: JobId; readonly status: typeof JOB_STATUS.running }
	| {
			readonly id: JobId;
			readonly status: typeof JOB_STATUS.done | typeof JOB_STATUS.failed;
			readonly outcome: RunOutcome;
	  }
	| {
			readonly id: JobId;
			readonly kind: typeof JOB_KIND.build;
			readonly status: typeof JOB_STATUS.running;
			readonly progress: Progress;
			readonly steps: readonly BuildStep[];
	  }
	| {
			readonly id: JobId;
			readonly kind: typeof JOB_KIND.build;
			readonly status:
				| typeof JOB_STATUS.done
				| typeof JOB_STATUS.failed
				| typeof JOB_STATUS.cancelled;
			readonly outcome: RunOutcome;
			readonly progress: Progress;
			readonly steps: readonly BuildStep[];
	  };
