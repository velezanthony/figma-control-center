import type { BuildStep, Progress } from "#domain/build.ts";
import type { JobId } from "#domain/job.ts";

// Lo que run-build entrega tras cada paso: el lote, todos sus pasos, el avance y el índice del paso que acaba de
// terminar (run-build llama onProgress justo después de dejarlo en estado terminal).
export type BuildProgressEvent = {
	readonly jobId: JobId;
	readonly steps: readonly BuildStep[];
	readonly progress: Progress;
	readonly stepIndex: number;
};

// Un solo lote a la vez: un único oyente basta. La sesión (main.ts) publica cada paso —también los
// que corren en segundo plano tras responder—; la herramienta figma_build se suscribe solo mientras atiende la
// llamada y se da de baja al responder, de modo que no sale ninguna notificación después.
export type BuildProgressBus = {
	publish(event: BuildProgressEvent): void;
	listen(sink: (event: BuildProgressEvent) => void): () => void;
};

export function createBuildProgressBus(): BuildProgressBus {
	let sink: ((event: BuildProgressEvent) => void) | null = null;
	return {
		publish(event) {
			sink?.(event);
		},
		listen(s) {
			sink = s;
			return () => {
				if (sink === s) sink = null;
			};
		},
	};
}

// «3/12 nombre-del-paso»: mensaje corto para notifications/progress.
export function progressMessage(event: BuildProgressEvent): string {
	const { done, total } = event.progress;
	const step = event.steps[event.stepIndex];
	return step === undefined
		? `${done}/${total}`
		: `${done}/${total} ${step.file}`;
}

// Limita las notifications/progress a una cada minIntervalMs. El último paso siempre se notifica: `flush` lo
// manda al terminar la llamada si el throttle lo había retenido.
export type ProgressNotifier = {
	push(event: BuildProgressEvent): void;
	flush(): Promise<void>;
};

export type ProgressNotifierDeps = {
	readonly send: (
		message: string,
		progress: number,
		total: number,
	) => Promise<void>;
	readonly minIntervalMs: number;
	readonly now?: () => number;
};

export function makeProgressNotifier(
	deps: ProgressNotifierDeps,
): ProgressNotifier {
	const now = deps.now ?? Date.now;
	let lastSentAt = Number.NEGATIVE_INFINITY;
	let pending: BuildProgressEvent | null = null;

	const emit = (event: BuildProgressEvent): Promise<void> => {
		lastSentAt = now();
		pending = null;
		// Una notificación de progreso es best-effort: si el envío falla, se traga. `push` lo lanza sin await
		// (`void emit`), así que sin este catch sería un unhandled rejection capaz de tumbar el proceso.
		return deps
			.send(progressMessage(event), event.progress.done, event.progress.total)
			.catch(() => {});
	};

	return {
		push(event) {
			if (now() - lastSentAt >= deps.minIntervalMs) void emit(event);
			else pending = event;
		},
		flush() {
			return pending === null ? Promise.resolve() : emit(pending);
		},
	};
}
