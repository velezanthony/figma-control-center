import type { ReadFile } from "#domain/catalog.ts";
import { type FigmaError, unexpectedScriptError } from "#domain/figma-error.ts";
import type { JobId } from "#domain/job.ts";
import { err, type Result } from "#domain/result.ts";
import { failed, type RunOutcome, succeeded } from "#domain/run-outcome.ts";
import type { JobRegistry } from "./job-registry.ts";
import type { FigmaReader } from "./ports/figma-reader.ts";
import type { ResultStore } from "./ports/result-store.ts";
import { withSoftDeadline } from "./with-soft-deadline.ts";

// Lo que deja una lectura: ReadFile o, si la herramienta responde algo más (figma_design_context), un tipo que lo amplía
export type ReadOutcome<T extends ReadFile = ReadFile> = Result<T, FigmaError>;

export type ReadRun<T extends ReadFile = ReadFile> =
	// jobId null: la lectura no llegó a enviarse (la pestaña no estaba lista)
	| {
			readonly kind: "finished";
			readonly jobId: JobId | null;
			readonly outcome: ReadOutcome<T>;
	  }
	| { readonly kind: "running"; readonly jobId: JobId }
	// Entrada inválida (p. ej. más nodos que el tope de figma_export): no se toca Figma
	| { readonly kind: "usage"; readonly message: string };

export type ReadFlowDeps = {
	readonly reader: Pick<FigmaReader, "ready">;
	readonly jobs: JobRegistry;
	readonly softDeadlineMs: number;
	// Reloj monótono en ms (por defecto, performance.now) para medir lo que tarda la lectura
	readonly now?: () => number;
	readonly onJobFinished?: (job: {
		readonly jobId: JobId;
		readonly outcome: RunOutcome;
		readonly ms: number;
	}) => void;
};

const defaultNow = () => performance.now();

// En el job, una lectura que acaba bien es un resultado sin nodos tocados: figma_get_job devuelve { path, bytes, summary }
const toRunOutcome = (outcome: ReadOutcome): RunOutcome =>
	outcome.ok ? succeeded(outcome.value, []) : failed(outcome.error);

// El flujo de run-script para las lecturas (decisiones 9 y 12): se espera a la pestaña, la lectura
// compite con el plazo blando y SIEMPRE queda registrada como job (corta o larga), con su aviso al terminar. No toma ni
// consulta el bloqueo de lote: una lectura convive con un figma_build en marcha.
export function makeRunRead(deps: ReadFlowDeps) {
	const now = deps.now ?? defaultNow;
	return async <T extends ReadFile>(
		work: () => Promise<ReadOutcome<T>>,
	): Promise<ReadRun<T>> => {
		const ready = await deps.reader.ready();
		if (!ready.ok) {
			return { kind: "finished", jobId: null, outcome: err(ready.error) };
		}

		const startedAt = now();
		const jobId = deps.jobs.start();
		const running = work().catch(
			(e: unknown): ReadOutcome<T> => err(unexpectedScriptError(e)),
		);
		const finished = running.then((outcome) => {
			deps.jobs.complete(jobId, toRunOutcome(outcome));
			deps.onJobFinished?.({
				jobId,
				outcome: toRunOutcome(outcome),
				ms: now() - startedAt,
			});
			return outcome;
		});
		const race = await withSoftDeadline(finished, deps.softDeadlineMs);
		return race.kind === "finished"
			? { kind: "finished", jobId, outcome: race.value }
			: { kind: "running", jobId };
	};
}

// Lo que reciben los casos de uso de lectura: el flujo de jobs, el lector, dónde guardar y la hora para nombrar el fichero
export type ReadDeps = {
	readonly runRead: ReturnType<typeof makeRunRead>;
	readonly reader: FigmaReader;
	readonly store: ResultStore;
	readonly clock: () => Date;
};

// El JSON completo a reads/ (siempre a fichero, decisión 1) y el resumen para la conversación
export async function storeRead(
	deps: Pick<ReadDeps, "store" | "clock">,
	tool: string,
	value: unknown,
	summary: ReadFile["summary"],
): Promise<ReadFile> {
	const stored = await deps.store.saveRead(JSON.stringify(value, null, 2), {
		tool,
		at: deps.clock(),
	});
	return { path: stored.path, bytes: stored.bytes, summary };
}
