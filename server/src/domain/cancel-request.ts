// Cancelar un lote desde el panel: el panel deja una petición y la sesión dueña del job la ejecuta.
// Archivo sin imports: lo comparten el servidor y el panel web (por tipos).

// Por qué se puede o no cancelar un job desde el panel
export const CANCEL_STATE = Object.freeze({
	available: "available",
	finished: "finished",
	notBatch: "notBatch",
	sessionGone: "sessionGone",
	requested: "requested",
} as const);

export type CancelState = (typeof CANCEL_STATE)[keyof typeof CANCEL_STATE];

export type CancelError =
	| { readonly type: "NoSuchJob"; readonly message: string }
	| {
			readonly type: "NotCancellable";
			readonly state: Exclude<CancelState, "available">;
			readonly message: string;
	  };

export type CancelRequestInfo = {
	readonly id: number;
	readonly jobId: string;
	readonly sessionId: string;
};
