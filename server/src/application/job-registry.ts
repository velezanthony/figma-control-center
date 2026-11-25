import { type BuildStep, progressOf } from "#domain/build.ts";
import { JOB_KIND, JOB_STATUS, type Job, type JobId } from "#domain/job.ts";
import type { RunOutcome } from "#domain/run-outcome.ts";

// Estado terminal de un lote: el que estaba en marcha deja de estarlo con uno de estos tres.
export type TerminalBuildStatus =
	| typeof JOB_STATUS.done
	| typeof JOB_STATUS.failed
	| typeof JOB_STATUS.cancelled;

export type JobRegistry = {
	start(): JobId;
	complete(id: JobId, outcome: RunOutcome): void;
	get(id: JobId): Job | undefined;
	// Lotes (figma_build). `tryStartBuild` reserva el lock y crea el job; undefined si otra sesión se adelantó con el
	// lock (nada se crea). `startBuild` es para quien sabe que está libre: si no, lanza.
	tryStartBuild(steps: readonly BuildStep[]): JobId | undefined;
	startBuild(steps: readonly BuildStep[]): JobId;
	updateBuild(id: JobId, steps: readonly BuildStep[]): void;
	completeBuild(
		id: JobId,
		status: TerminalBuildStatus,
		outcome: RunOutcome,
		steps: readonly BuildStep[],
	): void;
	// Cancelación entre pasos: la bandera la lee `run-build` al pasar de un paso al siguiente.
	requestCancel(id: JobId): void;
	isCancelRequested(id: JobId): boolean;
	// Deshace una reserva de lote que no llegó a ejecutarse (validación fallida): quita el job y libera el lock.
	abandonBuild(id: JobId): void;
	// Tras un Timeout el script sigue en la pestaña: el lock del lote no se suelta al cerrarlo sino cuando `until` se resuelve.
	// Hay que llamarlo antes de `completeBuild`.
	holdBuildLock(id: JobId, until: Promise<void>): void;
	// Hay un script vencido que sigue ejecutándose en la pestaña (el lock lo retiene)
	staleScript(): boolean;
	// Un lote a la vez: el id del lote en marcha, o undefined si no hay ninguno.
	activeBuild(): JobId | undefined;
	// El pid de OTRA sesión (otro proceso) que tiene el lock; undefined si está libre o es de este proceso
	foreignLockPid(): number | undefined;
	// Se resuelve cuando el job termina (lo espera `figma_get_job` con waitMs); undefined si no existe o ya terminó.
	settleOf(id: JobId): Promise<void> | undefined;
};

type Settle = { readonly promise: Promise<void>; readonly resolve: () => void };

const deferredVoid = (): Settle => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};

// Lock de "un lote a la vez por pestaña". El de `localBuildLock` es de este registro
// (un lote a la vez por servidor/tenant; lo usan las pruebas y un tenant suelto). El de producción es de máquina:
// `adapters/fs/fs-build-lock.ts` lo comparte entre procesos con un fichero por archivo de Figma (por su fileKey),
// así que dos sesiones de Claude Code sobre el mismo archivo no pueden tener un lote a la vez.
export type BuildLock = {
	// true si lo ha tomado; false si ya estaba tomado (por este registro u otro proceso)
	acquire(id: JobId): boolean;
	release(id: JobId): void;
	active(): JobId | undefined;
	// El pid del OTRO proceso que lo tiene (no definido en los locks locales)
	foreignPid?(): number | undefined;
};

export function localBuildLock(): BuildLock {
	let active: JobId | undefined;
	return {
		acquire: (id) => {
			if (active !== undefined) return false;
			active = id;
			return true;
		},
		release: (id) => {
			if (active === id) active = undefined;
		},
		active: () => active,
	};
}

// Cuántos jobs terminados se conservan para consultarlos con figma_get_job; los más antiguos se podan.
const DEFAULT_MAX_FINISHED_JOBS = 500;

export type JobRegistryOptions = { readonly maxFinished?: number };

// En memoria: los jobs se pierden al reiniciar el servidor
export function createJobRegistry(
	newId: () => JobId,
	lock: BuildLock = localBuildLock(),
	options: JobRegistryOptions = {},
): JobRegistry {
	const maxFinished = options.maxFinished ?? DEFAULT_MAX_FINISHED_JOBS;
	const jobs = new Map<JobId, Job>();
	const cancels = new Set<JobId>();
	const settles = new Map<JobId, Settle>();
	const held = new Set<JobId>();
	const finished: JobId[] = [];

	const finish = (id: JobId) => {
		finished.push(id);
		while (finished.length > maxFinished) {
			const oldest = finished.shift();
			if (oldest !== undefined) jobs.delete(oldest);
		}
	};

	return {
		start() {
			const id = newId();
			jobs.set(id, { id, status: JOB_STATUS.running });
			settles.set(id, deferredVoid());
			return id;
		},
		complete(id, outcome) {
			jobs.set(id, {
				id,
				status: outcome.ok ? JOB_STATUS.done : JOB_STATUS.failed,
				outcome,
			});
			settles.get(id)?.resolve();
			settles.delete(id);
			finish(id);
		},
		get: (id) => jobs.get(id),
		tryStartBuild(steps) {
			const id = newId();
			// El lock primero: si otra sesión lo tiene, no queda ningún job a medias
			if (!lock.acquire(id)) return undefined;
			jobs.set(id, {
				id,
				kind: JOB_KIND.build,
				status: JOB_STATUS.running,
				progress: progressOf(steps),
				steps,
			});
			settles.set(id, deferredVoid());
			return id;
		},
		startBuild(steps) {
			const id = this.tryStartBuild(steps);
			if (id === undefined) {
				throw new Error("startBuild: el lock de lote ya estaba tomado");
			}
			return id;
		},
		updateBuild(id, steps) {
			jobs.set(id, {
				id,
				kind: JOB_KIND.build,
				status: JOB_STATUS.running,
				progress: progressOf(steps),
				steps,
			});
		},
		completeBuild(id, status, outcome, steps) {
			jobs.set(id, {
				id,
				kind: JOB_KIND.build,
				status,
				outcome,
				progress: progressOf(steps),
				steps,
			});
			if (!held.has(id)) lock.release(id);
			settles.get(id)?.resolve();
			settles.delete(id);
			cancels.delete(id);
			finish(id);
		},
		holdBuildLock(id, until) {
			held.add(id);
			void until.then(() => {
				held.delete(id);
				lock.release(id);
			});
		},
		staleScript: () => held.size > 0,
		abandonBuild(id) {
			jobs.delete(id);
			lock.release(id);
			settles.get(id)?.resolve();
			settles.delete(id);
			cancels.delete(id);
		},
		requestCancel(id) {
			cancels.add(id);
		},
		isCancelRequested: (id) => cancels.has(id),
		activeBuild: () => lock.active(),
		foreignLockPid: () => lock.foreignPid?.(),
		settleOf: (id) => settles.get(id)?.promise,
	};
}
