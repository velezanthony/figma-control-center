import type { SessionCredentials } from "#application/ports/chat.ts";
import type {
	PermissionAsk,
	PermissionInbox,
	PermissionPanel,
	PermissionVerdict,
} from "#application/ports/permissions.ts";
import type {
	PermissionBehavior,
	PermissionError,
	PermissionRequest,
} from "#domain/permission.ts";
import { err, ok, type Result } from "#domain/result.ts";

type Stored = {
	id: number;
	sessionId: string;
	ask: PermissionAsk;
	status: "pending" | "allowed" | "denied" | "rejected";
	proof: string | null;
	sent: boolean;
};

// Almacén de permisos en memoria con las mismas garantías que el real: solo se decide una vez, la firma es la del
// token de la sesión y quien no la tenga no llega a `verdicts`
export class InMemoryPermissionStore
	implements PermissionInbox, PermissionPanel
{
	readonly all: Stored[] = [];
	// Sesiones cuyo proceso ya no existe
	readonly dead = new Set<string>();
	readonly #tokens = new Map<string, string>();
	#next = 1;

	static proof(token: string): string {
		return `huella:${token}`;
	}

	register({ sessionId, token }: SessionCredentials): void {
		this.#tokens.set(sessionId, InMemoryPermissionStore.proof(token));
	}

	record(
		{ sessionId }: SessionCredentials,
		ask: PermissionAsk,
	): PermissionRequest | null {
		if (
			this.all.some(
				(r) => r.sessionId === sessionId && r.ask.requestId === ask.requestId,
			)
		) {
			return null;
		}
		const row: Stored = {
			id: this.#next++,
			sessionId,
			ask,
			status: "pending",
			proof: null,
			sent: false,
		};
		this.all.push(row);
		return this.#view(row);
	}

	verdicts({
		sessionId,
		token,
	}: SessionCredentials): readonly PermissionVerdict[] {
		const proof = InMemoryPermissionStore.proof(token);
		const decided = this.all.filter(
			(r) =>
				r.sessionId === sessionId &&
				!r.sent &&
				(r.status === "allowed" || r.status === "denied"),
		);
		for (const r of decided) if (r.proof !== proof) r.status = "rejected";
		return decided.flatMap((r) =>
			r.status === "allowed" || r.status === "denied"
				? [
						{
							id: r.id,
							requestId: r.ask.requestId,
							behavior: r.status === "allowed" ? "allow" : "deny",
						} as const,
					]
				: [],
		);
	}

	markSent(_c: SessionCredentials, id: number): void {
		const r = this.all.find((x) => x.id === id);
		if (r !== undefined) r.sent = true;
	}

	list(sessionId: string, limit: number): readonly PermissionRequest[] {
		return this.all
			.filter((r) => r.sessionId === sessionId && r.status !== "rejected")
			.slice(-limit)
			.map((r) => this.#view(r));
	}

	decide(input: {
		sessionId: string;
		token: string;
		id: number;
		behavior: PermissionBehavior;
	}): Result<PermissionRequest, PermissionError> {
		const registered = this.#tokens.get(input.sessionId);
		if (registered === undefined) {
			return err({
				type: "NoSuchSession",
				message: "Esa sesión no tiene chat.",
			});
		}
		const proof = InMemoryPermissionStore.proof(input.token);
		if (proof !== registered) {
			return err({ type: "InvalidToken", message: "Token inválido." });
		}
		const row = this.all.find(
			(r) => r.id === input.id && r.sessionId === input.sessionId,
		);
		if (row === undefined || row.status === "rejected") {
			return err({ type: "NoSuchRequest", message: "No existe esa petición." });
		}
		if (row.status !== "pending") {
			return err({ type: "AlreadyDecided", message: "Ya está contestada." });
		}
		if (this.dead.has(input.sessionId)) {
			return err({ type: "Expired", message: "La sesión terminó." });
		}
		row.status = input.behavior === "allow" ? "allowed" : "denied";
		row.proof = proof;
		return ok(this.#view(row));
	}

	#view(r: Stored): PermissionRequest {
		const decided = r.status === "allowed" || r.status === "denied";
		return {
			id: r.id,
			sessionId: r.sessionId,
			...r.ask,
			at: "2026-01-01T00:00:00.000Z",
			status:
				r.status === "pending" && this.dead.has(r.sessionId)
					? "expired"
					: r.status === "rejected"
						? "expired"
						: r.status,
			decidedAt: decided ? "2026-01-01T00:00:01.000Z" : null,
		};
	}
}
