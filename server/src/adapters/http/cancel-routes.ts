import { z } from "zod";
import type { CancelPanel } from "#application/ports/cancel-requests.ts";
import type { CancelError } from "#domain/cancel-request.ts";
import { parseBody } from "./input.ts";
import {
	type ApiRequest,
	type ApiResponse,
	failure,
	STATUS,
	untrusted,
} from "./request-guard.ts";
import { JOBS_ROUTE } from "./routes.ts";

const cancelBody = z.object({ jobId: z.string().min(1) });

const refusal = (error: CancelError): ApiResponse =>
	error.type === "NoSuchJob"
		? failure(STATUS.notFound, error.type, error.message)
		: {
				status: STATUS.conflict,
				body: {
					ok: false,
					error: {
						type: error.type,
						message: error.message,
						state: error.state,
					},
				},
			};

// /api/jobs/cancel: GET dice si un lote se puede cancelar desde el panel; POST deja la petición, que ejecuta la
// sesión dueña del job. Devuelve null si la ruta no es esta
export function handleCancelRequest(
	deps: {
		readonly panel: CancelPanel;
		readonly allowedHosts: readonly string[];
	},
	request: ApiRequest,
): ApiResponse | null {
	if (request.pathname !== JOBS_ROUTE.cancel) return null;
	if (request.method === "GET") {
		const job = request.params.get("job");
		if (job === null) {
			return failure(
				STATUS.badRequest,
				"MissingJob",
				"Falta el parámetro job.",
			);
		}
		const state = deps.panel.stateOf(job);
		return state === null
			? failure(STATUS.notFound, "NoSuchJob", `No existe el job ${job}.`)
			: { status: STATUS.ok, body: { ok: true, jobId: job, state } };
	}
	if (request.method === "POST") {
		const blocked = untrusted(request, deps.allowedHosts);
		if (blocked !== null) return blocked;
		const body = parseBody(cancelBody, request.body);
		if (body === null) {
			return failure(
				STATUS.badRequest,
				"InvalidBody",
				"Se esperaba { jobId }.",
			);
		}
		const asked = deps.panel.request(body.jobId);
		return asked.ok
			? { status: STATUS.ok, body: { ok: true, request: asked.value } }
			: refusal(asked.error);
	}
	return failure(
		STATUS.methodNotAllowed,
		"MethodNotAllowed",
		"Solo GET y POST.",
	);
}
