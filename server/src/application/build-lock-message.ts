import type { JobId } from "#domain/job.ts";
import type { JobRegistry } from "./job-registry.ts";

// Por qué se rechaza una escritura mientras el lock del lote está tomado
export function buildLockMessage(jobs: JobRegistry, jobId: JobId): string {
	const foreign = jobs.foreignLockPid();
	if (foreign !== undefined) {
		return `otra sesión de Claude Code (pid ${foreign}) tiene un lote en marcha sobre este mismo archivo de Figma (jobId ${jobId}); espera a que termine.`;
	}
	return jobs.staleScript()
		? `un script anterior (jobId ${jobId}) venció su plazo y sigue ejecutándose en la pestaña de Figma; espera a que termine o recarga la pestaña.`
		: `hay un lote en marcha: jobId ${jobId}`;
}
