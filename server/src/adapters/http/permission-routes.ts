import { z } from "zod";
import type { makeDecidePermission } from "#application/permissions.ts";
import type { PermissionPanel } from "#application/ports/permissions.ts";
import {
	PERMISSION_LIMITS,
	type PermissionBehavior,
	type PermissionError,
} from "#domain/permission.ts";
import { parseBody } from "./input.ts";
import {
	type ApiRequest,
	type ApiResponse,
	failure,
	STATUS,
	untrusted,
} from "./request-guard.ts";
import { CHAT_ROUTE } from "./routes.ts";

const STATUS_OF_ERROR: Readonly<Record<PermissionError["type"], number>> = {
	NoSuchSession: STATUS.notFound,
	NoSuchRequest: STATUS.notFound,
	InvalidToken: STATUS.forbidden,
	AlreadyDecided: STATUS.conflict,
	Expired: STATUS.conflict,
};

const BEHAVIORS = [
	"allow",
	"deny",
] as const satisfies readonly PermissionBehavior[];

const decisionBody = z.object({
	sessionId: z.string(),
	id: z.number().int().positive(),
	behavior: z.enum(BEHAVIORS),
});

// /api/chat/permissions: GET lista las peticiones de una sesión; POST contesta una (quien llama es el propio panel).
// Devuelve null si la ruta no es esta
export function handlePermissionRequest(
	deps: {
		readonly panel: PermissionPanel;
		readonly decide: ReturnType<typeof makeDecidePermission>;
		readonly allowedHosts: readonly string[];
	},
	request: ApiRequest,
): ApiResponse | null {
	if (request.pathname !== CHAT_ROUTE.permissions) return null;
	if (request.method === "GET") {
		const session = request.params.get("session");
		if (session === null) {
			return failure(
				STATUS.badRequest,
				"MissingSession",
				"Falta el parámetro session.",
			);
		}
		return {
			status: STATUS.ok,
			body: {
				ok: true,
				items: deps.panel.list(session, PERMISSION_LIMITS.listLimit),
			},
		};
	}
	if (request.method === "POST") {
		const blocked = untrusted(request, deps.allowedHosts);
		if (blocked !== null) return blocked;
		const input = parseBody(decisionBody, request.body);
		if (input === null) {
			return failure(
				STATUS.badRequest,
				"InvalidBody",
				"Se esperaba { sessionId, id, behavior: 'allow' | 'deny' }.",
			);
		}
		const decided = deps.decide(input);
		return decided.ok
			? { status: STATUS.ok, body: { ok: true, request: decided.value } }
			: failure(
					STATUS_OF_ERROR[decided.error.type],
					decided.error.type,
					decided.error.message,
				);
	}
	return failure(
		STATUS.methodNotAllowed,
		"MethodNotAllowed",
		"Solo GET y POST.",
	);
}
