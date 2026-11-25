import { and, asc, eq } from "drizzle-orm";
import type {
	CancelInbox,
	CancelPanel,
} from "#application/ports/cancel-requests.ts";
import {
	CANCEL_STATE,
	type CancelError,
	type CancelRequestInfo,
	type CancelState,
} from "#domain/cancel-request.ts";
import { JOB_STATUS } from "#domain/job.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import type { FigmaDb } from "./database.ts";
import { calls, cancelRequests, jobs, sessions } from "./schema.ts";

type Clock = { readonly now?: () => number };

const WRITE_TX = { behavior: "immediate" } as const;

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

// Lado de la sesión (proceso MCP): recoge lo que el panel pidió para los jobs de esta sesión
export class SqliteCancelMailbox implements CancelInbox {
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

	pending(sessionId: string): readonly CancelRequestInfo[] {
		return this.#db
			.select()
			.from(cancelRequests)
			.where(
				and(
					eq(cancelRequests.projectId, this.#projectId),
					eq(cancelRequests.sessionId, sessionId),
					eq(cancelRequests.status, "pending"),
				),
			)
			.orderBy(asc(cancelRequests.id))
			.all()
			.map((r) => ({ id: r.id, jobId: r.jobId, sessionId: r.sessionId }));
	}

	markHandled(sessionId: string, id: number): void {
		this.#db
			.update(cancelRequests)
			.set({ status: "done", handledAt: this.#now() })
			.where(
				and(
					eq(cancelRequests.projectId, this.#projectId),
					eq(cancelRequests.id, id),
					eq(cancelRequests.sessionId, sessionId),
				),
			)
			.run();
	}
}

// Lado del panel (proceso dashboard): ve si un job se puede cancelar y deja la petición
export class SqliteCancelPanel implements CancelPanel {
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

	#stateOf(
		tx: Pick<FigmaDb, "select">,
		jobId: string,
	): {
		state: CancelState;
		sessionId: string;
	} | null {
		const job = tx
			.select({
				status: jobs.status,
				sessionId: jobs.sessionId,
				tool: calls.tool,
				pid: sessions.pid,
			})
			.from(jobs)
			.leftJoin(
				calls,
				and(eq(calls.projectId, jobs.projectId), eq(calls.callId, jobs.callId)),
			)
			.leftJoin(
				sessions,
				and(
					eq(sessions.projectId, jobs.projectId),
					eq(sessions.id, jobs.sessionId),
				),
			)
			.where(and(eq(jobs.projectId, this.#projectId), eq(jobs.id, jobId)))
			.get();
		if (job === undefined) return null;
		const sessionId = job.sessionId;
		const known = tx
			.select({ id: cancelRequests.id })
			.from(cancelRequests)
			.where(
				and(
					eq(cancelRequests.projectId, this.#projectId),
					eq(cancelRequests.jobId, jobId),
				),
			)
			.get();
		const state =
			job.status !== JOB_STATUS.running
				? CANCEL_STATE.finished
				: job.tool !== TOOL_NAME.build
					? CANCEL_STATE.notBatch
					: job.pid == null || !this.#isAlive(job.pid)
						? CANCEL_STATE.sessionGone
						: known !== undefined
							? CANCEL_STATE.requested
							: CANCEL_STATE.available;
		return { state, sessionId };
	}

	stateOf(jobId: string): CancelState | null {
		return this.#stateOf(this.#db, jobId)?.state ?? null;
	}

	request(jobId: string): Result<CancelRequestInfo, CancelError> {
		return this.#db.transaction(
			(tx): Result<CancelRequestInfo, CancelError> => {
				const found = this.#stateOf(tx, jobId);
				if (found === null) {
					return err({
						type: "NoSuchJob",
						message: `No existe el job ${jobId}.`,
					});
				}
				if (found.state !== CANCEL_STATE.available) {
					return err({
						type: "NotCancellable",
						state: found.state,
						message: `El job ${jobId} no se puede cancelar desde el panel (${found.state}).`,
					});
				}
				const row = tx
					.insert(cancelRequests)
					.values({
						projectId: this.#projectId,
						sessionId: found.sessionId,
						jobId,
						at: this.#now(),
						status: "pending",
					})
					.returning()
					.get();
				return ok({ id: row.id, jobId, sessionId: found.sessionId });
			},
			WRITE_TX,
		);
	}
}
