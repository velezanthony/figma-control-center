import type { Job } from "#domain/job.ts";
import { JOB_STATUS, toJobId } from "#domain/job.ts";
import type { JobRegistry } from "./job-registry.ts";
import { withSoftDeadline } from "./with-soft-deadline.ts";

export type GetJobDeps = { readonly softDeadlineMs: number };

// La espera acaba al terminar el job o, antes, si quien pregunta cancela (`signal`)
async function settleOrAbort(
	settle: Promise<unknown>,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (signal?.aborted === true) return;
	let onAbort = () => {};
	const aborted = new Promise<void>((resolve) => {
		onAbort = () => resolve();
		signal?.addEventListener("abort", onAbort, { once: true });
	});
	try {
		await Promise.race([settle, aborted]);
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
}

// null = el job no existe (nunca se creó o el servidor se reinició). Con `waitMs` espera a que el job termine o
// venza ese tiempo (con tope el plazo blando), o a que quien pregunta cancele, y devuelve el estado de entonces.
export const makeGetJob =
	(jobs: JobRegistry, deps: GetJobDeps) =>
	async (
		jobId: string,
		waitMs?: number,
		signal?: AbortSignal,
	): Promise<Job | null> => {
		const id = toJobId(jobId);
		const job = jobs.get(id);
		const settle = jobs.settleOf(id);
		if (
			job !== undefined &&
			job.status === JOB_STATUS.running &&
			settle !== undefined &&
			waitMs !== undefined &&
			waitMs > 0
		) {
			await withSoftDeadline(
				settleOrAbort(settle, signal),
				Math.min(waitMs, deps.softDeadlineMs),
			);
		}
		return jobs.get(id) ?? null;
	};
