import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
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
import { hashToken } from "./chat-token.ts";
import type { FigmaDb } from "./database.ts";
import { permissionRequests, sessions } from "./schema.ts";

type Clock = { readonly now?: () => number };
type Row = typeof permissionRequests.$inferSelect;

const WRITE_TX = { behavior: "immediate" } as const;

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

const iso = (ms: number): string => new Date(ms).toISOString();

// Lado de la sesión (proceso MCP): guarda lo que pide Claude Code y recoge lo que el panel decidió
export class SqlitePermissionMailbox implements PermissionInbox {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #now: () => number;

	constructor(
		options: { readonly db: FigmaDb; readonly projectId: number } & Clock,
	) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#now = options.now ?? Date.now;
	}

	record(
		{ sessionId }: SessionCredentials,
		ask: PermissionAsk,
	): PermissionRequest | null {
		const row = this.#db
			.insert(permissionRequests)
			.values({
				projectId: this.#projectId,
				sessionId,
				requestId: ask.requestId,
				toolName: ask.toolName,
				description: ask.description,
				inputPreview: ask.inputPreview,
				at: this.#now(),
				status: "pending",
			})
			.onConflictDoNothing()
			.returning()
			.get();
		return row === undefined ? null : toRequest(row, true);
	}

	verdicts({
		sessionId,
		token,
	}: SessionCredentials): readonly PermissionVerdict[] {
		const proof = hashToken(token);
		return this.#db.transaction((tx) => {
			const decided = tx
				.select()
				.from(permissionRequests)
				.where(
					and(
						eq(permissionRequests.projectId, this.#projectId),
						eq(permissionRequests.sessionId, sessionId),
						isNull(permissionRequests.sentAt),
						or(
							eq(permissionRequests.status, "allowed"),
							eq(permissionRequests.status, "denied"),
						),
					),
				)
				.orderBy(asc(permissionRequests.id))
				.all();
			// Una decisión sin la firma de esta sesión no la tomó el panel: se descarta para siempre
			for (const r of decided.filter((d) => d.deciderHash !== proof)) {
				tx.update(permissionRequests)
					.set({ status: "rejected" })
					.where(
						and(
							eq(permissionRequests.projectId, this.#projectId),
							eq(permissionRequests.id, r.id),
						),
					)
					.run();
			}
			return decided
				.filter((d) => d.deciderHash === proof)
				.map((d) => ({
					id: d.id,
					requestId: d.requestId,
					behavior:
						d.status === "allowed" ? ("allow" as const) : ("deny" as const),
				}));
		}, WRITE_TX);
	}

	markSent({ sessionId }: SessionCredentials, id: number): void {
		this.#db
			.update(permissionRequests)
			.set({ sentAt: this.#now() })
			.where(
				and(
					eq(permissionRequests.projectId, this.#projectId),
					eq(permissionRequests.id, id),
					eq(permissionRequests.sessionId, sessionId),
				),
			)
			.run();
	}
}

function toRequest(row: Row, alive: boolean): PermissionRequest {
	return {
		id: row.id,
		sessionId: row.sessionId,
		requestId: row.requestId,
		toolName: row.toolName,
		description: row.description,
		inputPreview: row.inputPreview,
		at: iso(row.at),
		status:
			row.status === "pending"
				? alive
					? "pending"
					: "expired"
				: row.status === "allowed"
					? "allowed"
					: row.status === "denied"
						? "denied"
						: "expired",
		decidedAt: row.decidedAt === null ? null : iso(row.decidedAt),
	};
}

// Lado del panel (proceso dashboard)
export class SqlitePermissionPanel implements PermissionPanel {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #now: () => number;
	readonly #isAlive: (pid: number) => boolean;

	constructor(
		options: {
			readonly db: FigmaDb;
			readonly projectId: number;
			readonly isAlive?: (pid: number) => boolean;
		} & Clock,
	) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#now = options.now ?? Date.now;
		this.#isAlive = options.isAlive ?? processAlive;
	}

	#alive(sessionId: string): boolean {
		const pid = this.#db
			.select({ pid: sessions.pid })
			.from(sessions)
			.where(
				and(
					eq(sessions.projectId, this.#projectId),
					eq(sessions.id, sessionId),
				),
			)
			.get()?.pid;
		return pid != null && this.#isAlive(pid);
	}

	list(sessionId: string, limit: number): readonly PermissionRequest[] {
		const alive = this.#alive(sessionId);
		return this.#db
			.select()
			.from(permissionRequests)
			.where(
				and(
					eq(permissionRequests.projectId, this.#projectId),
					eq(permissionRequests.sessionId, sessionId),
				),
			)
			.orderBy(desc(permissionRequests.id))
			.limit(limit)
			.all()
			.filter((r) => r.status !== "rejected")
			.reverse()
			.map((r) => toRequest(r, alive));
	}

	decide(input: {
		sessionId: string;
		token: string;
		id: number;
		behavior: PermissionBehavior;
	}): Result<PermissionRequest, PermissionError> {
		return this.#db.transaction(
			(tx): Result<PermissionRequest, PermissionError> => {
				const session = tx
					.select({ hash: sessions.chatTokenHash })
					.from(sessions)
					.where(
						and(
							eq(sessions.projectId, this.#projectId),
							eq(sessions.id, input.sessionId),
						),
					)
					.get();
				if (session?.hash == null) {
					return err({
						type: "NoSuchSession",
						message: `La sesión ${input.sessionId} no tiene chat.`,
					});
				}
				const proof = hashToken(input.token);
				if (proof !== session.hash) {
					return err({
						type: "InvalidToken",
						message: "El token no es el de esa sesión.",
					});
				}
				const row = tx
					.select()
					.from(permissionRequests)
					.where(
						and(
							eq(permissionRequests.projectId, this.#projectId),
							eq(permissionRequests.id, input.id),
							eq(permissionRequests.sessionId, input.sessionId),
						),
					)
					.get();
				if (row === undefined || row.status === "rejected") {
					return err({
						type: "NoSuchRequest",
						message: "No existe esa petición de permiso.",
					});
				}
				if (row.status !== "pending") {
					return err({
						type: "AlreadyDecided",
						message: "Esa petición ya está contestada.",
					});
				}
				if (!this.#alive(input.sessionId)) {
					return err({
						type: "Expired",
						message: "La sesión ya terminó: nadie espera esta respuesta.",
					});
				}
				const decided = tx
					.update(permissionRequests)
					.set({
						status: input.behavior === "allow" ? "allowed" : "denied",
						decidedAt: this.#now(),
						deciderHash: proof,
					})
					.where(
						and(
							eq(permissionRequests.projectId, this.#projectId),
							eq(permissionRequests.id, row.id),
							eq(permissionRequests.status, "pending"),
						),
					)
					.returning()
					.get();
				return ok(toRequest(decided, true));
			},
			WRITE_TX,
		);
	}
}
