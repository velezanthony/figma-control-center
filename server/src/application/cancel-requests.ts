import { toJobId } from "#domain/job.ts";
import type { CancelJobInput, CancelJobResult } from "./cancel-job.ts";
import type { CancelInbox, CancelPanel } from "./ports/cancel-requests.ts";

const reasonOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// Lado del panel: pedir que se cancele un lote
export function makeRequestCancel(deps: { readonly panel: CancelPanel }) {
	return (jobId: string) => deps.panel.request(jobId);
}

// Lado de la sesión: ejecuta, con el caso de uso de siempre, las cancelaciones que el panel dejó para sus jobs.
// Si cancelar falla, la petición se queda pendiente y se reintenta en el siguiente sondeo
export function makeHandleCancelRequests(deps: {
	readonly inbox: CancelInbox;
	readonly sessionId: string;
	readonly cancelJob: (input: CancelJobInput) => Promise<CancelJobResult>;
	readonly warn: (message: string) => void;
}): () => Promise<number> {
	return async () => {
		let handled = 0;
		for (const request of deps.inbox.pending(deps.sessionId)) {
			try {
				await deps.cancelJob({ jobId: toJobId(request.jobId) });
			} catch (e) {
				deps.warn(
					`cancelar: no se pudo cancelar ${request.jobId}: ${reasonOf(e)}`,
				);
				continue;
			}
			deps.inbox.markHandled(deps.sessionId, request.id);
			handled++;
		}
		return handled;
	};
}
