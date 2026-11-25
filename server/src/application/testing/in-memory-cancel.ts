import type { CancelPanel } from "#application/ports/cancel-requests.ts";
import { err } from "#domain/result.ts";

// Panel de cancelaciones sin ningún job: para montar un tenant del panel en los tests que no hablan de cancelar
export const noCancelPanel: CancelPanel = {
	stateOf: () => null,
	request: (jobId) =>
		err({ type: "NoSuchJob", message: `No existe el job ${jobId}.` }),
};
