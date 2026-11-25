import { and, eq, inArray, lt, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { ActivityLog } from "#application/ports/activity-log.ts";
import type {
	HistoryMaintenance,
	ImportOutcome,
	PruneResult,
} from "#application/ports/history-maintenance.ts";
import {
	ACTIVITY_ERROR,
	ACTIVITY_TYPE,
	type ActivityEvent,
	type ArgsSummary,
	type BuildStepFinished,
	type JobFinished,
	type ToolFinished,
} from "#domain/activity.ts";
import { summarizeCall } from "#domain/call-summary.ts";
import type { CallStatus } from "#domain/history.ts";
import { JOB_STATUS } from "#domain/job.ts";
import { isWriteTool, ranInTab } from "#domain/tool-names.ts";
import type { FigmaDb } from "./database.ts";
import {
	buildSteps,
	callNodes,
	calls,
	captures,
	events,
	jobs,
	meta,
	nodesTouched,
	sessions,
} from "./schema.ts";

type Tx = Parameters<Parameters<FigmaDb["transaction"]>[0]>[0];
type CallRow = typeof calls.$inferSelect;
type JobRow = typeof jobs.$inferSelect;

const IMPORT_KEY_PREFIX = "import:";
const IMPORTED = "1";
const TEXT_SEPARATOR = " ";
// BEGIN IMMEDIATE: quien va a escribir lo dice desde el principio. Con el modo diferido, leer y luego
// escribir puede fallar en el acto si otro proceso confirmó entre medias (WAL no espera en ese caso)
const WRITE_TX = { behavior: "immediate" } as const;

const reasonOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

const parseJson = <T>(text: string): T => JSON.parse(text) as T;

function statusOf(call: CallRow): CallStatus {
	return call.status;
}

// El resumen de la llamada, con el desenlace de su job al final si lo lanzó
function summaryOf(call: CallRow, job: JobRow | null): string {
	const base = summarizeCall({
		tool: call.tool,
		args: parseJson<ArgsSummary>(call.argsSummary),
		status: statusOf(call),
		ms: call.ms,
		touchedCount: call.touchedCount,
		errorType: call.errorType,
	});
	if (job === null || job.status === JOB_STATUS.running) return base;
	if (job.status === JOB_STATUS.done) return `${base} · job terminado`;
	if (job.status === JOB_STATUS.cancelled) return `${base} · job cancelado`;
	return `${base} · job fallido ${job.errorType ?? "desconocido"}`;
}

// Registra la actividad en SQLite: cada evento va al registro inmutable y actualiza las tablas de consulta
// (llamadas, sesiones, jobs, nodos, capturas) en la misma transacción. Un solo escritor por proceso
export class SqliteActivityLog implements ActivityLog, HistoryMaintenance {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #warn: (message: string) => void;

	constructor(options: {
		readonly db: FigmaDb;
		readonly projectId: number;
		readonly warn: (message: string) => void;
	}) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#warn = options.warn;
	}

	// Toda condición pasa por aquí: lo del proyecto va siempre, no se puede olvidar
	#own(
		table: { readonly projectId: SQLiteColumn },
		...conditions: readonly (SQL | undefined)[]
	): SQL | undefined {
		return and(eq(table.projectId, this.#projectId), ...conditions);
	}

	record(event: ActivityEvent): void {
		try {
			this.#db.transaction((tx) => this.#apply(tx, event), WRITE_TX);
		} catch (e) {
			this.#warn(
				`histórico: no se pudo registrar ${event.type}: ${reasonOf(e)}`,
			);
		}
	}

	prune(olderThan: Date): PruneResult {
		const cutoff = olderThan.getTime();
		return this.#db.transaction((tx) => {
			const removedEvents = tx
				.delete(events)
				.where(this.#own(events, lt(events.at, cutoff)))
				.run();
			const removedCalls = tx
				.delete(calls)
				.where(this.#own(calls, lt(calls.startedAt, cutoff)))
				.run();
			tx.delete(jobs)
				.where(this.#own(jobs, lt(jobs.startedAt, cutoff)))
				.run();
			tx.delete(nodesTouched)
				.where(this.#own(nodesTouched, lt(nodesTouched.lastAt, cutoff)))
				.run();
			const removedSessions = tx
				.delete(sessions)
				.where(this.#own(sessions, lt(sessions.lastSeenAt, cutoff)))
				.run();
			const { attempts: removedAttempts, scripts: removedScripts } =
				this.#pruneAttempts(tx, cutoff);
			return {
				events: removedEvents.changes,
				calls: removedCalls.changes,
				sessions: removedSessions.changes,
				attempts: removedAttempts,
				scripts: removedScripts,
			};
		}, WRITE_TX);
	}

	// Historial de intentos: los más viejos que el corte, SALVO el último `ok` de cada objetivo
	// (tipo + objetivo); después, los contenidos que ningún intento usa
	#pruneAttempts(
		tx: Tx,
		cutoff: number,
	): { attempts: number; scripts: number } {
		const p = this.#projectId;
		const doomed = sql`SELECT a.id FROM attempts a WHERE a.project_id = ${p} AND a.started_at < ${cutoff}
			AND NOT (a.status = 'ok' AND a.n = (SELECT max(b.n) FROM attempts b WHERE b.project_id = a.project_id
				AND b.kind = a.kind AND b.target = a.target AND b.status = 'ok'))`;
		tx.run(
			sql`DELETE FROM attempt_scripts WHERE project_id = ${p} AND attempt_id IN (${doomed})`,
		);
		const removed = tx.run(sql`DELETE FROM attempts WHERE id IN (${doomed})`);
		const orphans = tx.run(sql`DELETE FROM script_blobs WHERE project_id = ${p}
			AND NOT EXISTS (SELECT 1 FROM attempt_scripts s WHERE s.project_id = script_blobs.project_id AND s.sha256 = script_blobs.sha256)`);
		return { attempts: removed.changes, scripts: orphans.changes };
	}

	interruptSessionJobs(sessionId: string, reason: string, at: Date): number {
		return this.#db.transaction(
			(tx) => this.#interrupt(tx, [sessionId], reason, at.getTime()),
			WRITE_TX,
		);
	}

	interruptDeadSessionJobs(options: {
		readonly ownSessionId: string;
		readonly isAlive: (pid: number | null) => boolean;
		readonly reason: string;
		readonly at: Date;
	}): number {
		return this.#db.transaction((tx) => {
			const owners = tx
				.selectDistinct({ id: sessions.id, pid: sessions.pid })
				.from(sessions)
				.innerJoin(
					jobs,
					and(
						eq(jobs.projectId, sessions.projectId),
						eq(jobs.sessionId, sessions.id),
					),
				)
				.where(this.#own(sessions, eq(jobs.status, JOB_STATUS.running)))
				.all();
			const dead = owners
				.filter((o) => o.id !== options.ownSessionId && !options.isAlive(o.pid))
				.map((o) => o.id);
			return this.#interrupt(tx, dead, options.reason, options.at.getTime());
		}, WRITE_TX);
	}

	// Un job en marcha cuyo proceso desapareció no va a terminar nunca: se cierra `failed` con el motivo, y su paso en
	// curso también (los pendientes se quedan como estaban: nunca empezaron)
	#interrupt(
		tx: Tx,
		sessionIds: readonly string[],
		reason: string,
		atMs: number,
	): number {
		if (sessionIds.length === 0) return 0;
		const running = tx
			.select()
			.from(jobs)
			.where(
				this.#own(
					jobs,
					eq(jobs.status, JOB_STATUS.running),
					inArray(jobs.sessionId, [...sessionIds]),
				),
			)
			.all();
		for (const job of running) {
			tx.update(jobs)
				.set({
					status: JOB_STATUS.failed,
					finishedAt: atMs,
					ms: Math.max(0, atMs - job.startedAt),
					errorType: ACTIVITY_ERROR.interrupted,
					errorMessage: reason,
				})
				.where(this.#own(jobs, eq(jobs.id, job.id)))
				.run();
			tx.update(buildSteps)
				.set({
					status: "failed",
					errorType: ACTIVITY_ERROR.interrupted,
					errorMessage: reason,
				})
				.where(
					this.#own(
						buildSteps,
						eq(buildSteps.jobId, job.id),
						eq(buildSteps.status, "running"),
					),
				)
				.run();
		}
		return running.length;
	}

	importOnce(key: string, toImport: readonly ActivityEvent[]): ImportOutcome {
		return this.#db.transaction((tx): ImportOutcome => {
			const marker = `${IMPORT_KEY_PREFIX}${key}`;
			const done = tx
				.select()
				.from(meta)
				.where(this.#own(meta, eq(meta.key, marker)))
				.get();
			if (done !== undefined) return { status: "already-imported" };
			for (const event of toImport) this.#apply(tx, event);
			tx.insert(meta)
				.values({ projectId: this.#projectId, key: marker, value: IMPORTED })
				.run();
			return { status: "imported", events: toImport.length };
		}, WRITE_TX);
	}

	#apply(tx: Tx, event: ActivityEvent): void {
		const atMs = Date.parse(event.at);
		this.#touchSession(tx, event, atMs);
		tx.insert(events)
			.values({
				projectId: this.#projectId,
				sessionId: event.sessionId,
				callId: "callId" in event ? event.callId : null,
				at: atMs,
				type: event.type,
				payload: JSON.stringify(event),
			})
			.run();

		switch (event.type) {
			case ACTIVITY_TYPE.sessionStarted:
			case ACTIVITY_TYPE.statusChecked:
				return;
			case ACTIVITY_TYPE.toolCalled:
				this.#toolCalled(tx, event, atMs);
				return;
			case ACTIVITY_TYPE.toolFinished:
				this.#toolFinished(tx, event, atMs);
				return;
			case ACTIVITY_TYPE.jobFinished:
				this.#jobFinished(tx, event, atMs);
				return;
			case ACTIVITY_TYPE.buildStepFinished:
				this.#buildStepFinished(tx, event);
				return;
			case ACTIVITY_TYPE.screenshotSaved: {
				const call = this.#call(tx, event.callId);
				if (call === undefined) return;
				tx.insert(captures)
					.values({
						projectId: this.#projectId,
						callId: event.callId,
						nodeId: event.nodeId,
						path: event.path,
						width: event.width,
						height: event.height,
						at: atMs,
					})
					.onConflictDoNothing()
					.run();
				return;
			}
			default: {
				const unreachable: never = event;
				throw new Error(
					`evento no contemplado: ${JSON.stringify(unreachable)}`,
				);
			}
		}
	}

	#touchSession(tx: Tx, event: ActivityEvent, atMs: number): void {
		const started = event.type === ACTIVITY_TYPE.sessionStarted;
		const info = started ? { pid: event.pid, fileUrl: event.fileUrl } : {};
		tx.insert(sessions)
			.values({
				projectId: this.#projectId,
				id: event.sessionId,
				startedAt: atMs,
				lastSeenAt: atMs,
				...info,
			})
			.onConflictDoUpdate({
				target: [sessions.projectId, sessions.id],
				set: {
					lastSeenAt: sql`max(${sessions.lastSeenAt}, ${atMs})`,
					...(started && { ...info, startedAt: atMs }),
				},
			})
			.run();
	}

	#call(tx: Tx, callId: string): CallRow | undefined {
		return tx
			.select()
			.from(calls)
			.where(this.#own(calls, eq(calls.callId, callId)))
			.get();
	}

	#job(tx: Tx, jobId: string): JobRow | undefined {
		return tx
			.select()
			.from(jobs)
			.where(this.#own(jobs, eq(jobs.id, jobId)))
			.get();
	}

	#toolCalled(
		tx: Tx,
		event: Extract<ActivityEvent, { type: "tool_called" }>,
		atMs: number,
	): void {
		const write = isWriteTool(event.tool);
		const inserted = tx
			.insert(calls)
			.values({
				projectId: this.#projectId,
				callId: event.callId,
				sessionId: event.sessionId,
				startedAt: atMs,
				tool: event.tool,
				status: "running",
				isWrite: write,
				argsSummary: JSON.stringify(event.args),
				summary: summarizeCall({
					tool: event.tool,
					args: event.args,
					status: "running",
					ms: null,
					touchedCount: 0,
					errorType: null,
				}),
			})
			.onConflictDoNothing()
			.run();
		if (inserted.changes === 0) return;
		tx.update(sessions)
			.set({ calls: sql`${sessions.calls} + 1` })
			.where(this.#own(sessions, eq(sessions.id, event.sessionId)))
			.run();
	}

	#toolFinished(tx: Tx, event: ToolFinished, atMs: number): void {
		const call = this.#call(tx, event.callId);
		if (call === undefined || call.status !== "running") return;
		const args = parseJson<ArgsSummary>(call.argsSummary);
		const startsJob = event.jobId !== undefined && args["jobId"] === undefined;
		const error = event.error;
		const finished: CallRow = {
			...call,
			status: event.ok ? "ok" : "error",
			ms: event.ms,
			errorType: error?.type ?? null,
		};
		tx.update(calls)
			.set({
				status: finished.status,
				finishedAt: atMs,
				ms: event.ms,
				errorType: error?.type ?? null,
				errorMessage: error?.message ?? null,
				nextStep: error?.nextStep ?? null,
				errorLine: error?.line ?? null,
				retryable: event.retryable ?? null,
				jobId: event.jobId ?? null,
				startsJob,
				resultPath: event.resultPath ?? null,
			})
			.where(this.#own(calls, eq(calls.callId, call.callId)))
			.run();
		// Las consultas de un job (con jobId en los argumentos) no enlazan nodos: cuentan para quien lo lanzó
		if (args["jobId"] === undefined) {
			this.#touchNodes(tx, call, event.touchedNodeIds, atMs);
		}
		const wrote = ranInTab(call.tool, event.ok, error?.type ?? null);
		tx.update(sessions)
			.set({
				writes: sql`${sessions.writes} + ${wrote ? 1 : 0}`,
				errors: sql`${sessions.errors} + ${event.ok ? 0 : 1}`,
				totalMs: sql`${sessions.totalMs} + ${event.ms}`,
			})
			.where(this.#own(sessions, eq(sessions.id, call.sessionId)))
			.run();

		let job: JobRow | null = null;
		if (startsJob && event.jobId !== undefined) {
			tx.insert(jobs)
				.values({
					projectId: this.#projectId,
					id: event.jobId,
					sessionId: call.sessionId,
					callId: call.callId,
					startedAt: call.startedAt,
					status: JOB_STATUS.running,
				})
				.onConflictDoUpdate({
					target: [jobs.projectId, jobs.id],
					set: { callId: call.callId, startedAt: call.startedAt },
				})
				.run();
			job = this.#job(tx, event.jobId) ?? null;
		}
		const now = this.#call(tx, call.callId) ?? finished;
		tx.update(calls)
			.set({ summary: summaryOf(now, job) })
			.where(this.#own(calls, eq(calls.callId, call.callId)))
			.run();
		// El job ya había terminado antes de que se registrara quien lo lanzó: se le suma ahora
		if (job !== null && job.status !== JOB_STATUS.running) {
			this.#absorbJob(tx, job, job.finishedAt ?? atMs);
		}
	}

	#jobFinished(tx: Tx, event: JobFinished, atMs: number): void {
		const known = this.#job(tx, event.jobId);
		if (known !== undefined && known.status !== JOB_STATUS.running) return;
		// Un lote trae su estado final (incluido `cancelled`, que es ok:true); un job de script lo deduce de `ok`
		const status =
			event.status ?? (event.ok ? JOB_STATUS.done : JOB_STATUS.failed);
		const fields = {
			status,
			ms: event.ms,
			finishedAt: atMs,
			errorType: event.error?.type ?? null,
			errorMessage: event.error?.message ?? null,
			nextStep: event.error?.nextStep ?? null,
			errorLine: event.error?.line ?? null,
			touchedJson: JSON.stringify(event.touchedNodeIds),
		};
		tx.insert(jobs)
			.values({
				projectId: this.#projectId,
				id: event.jobId,
				sessionId: event.sessionId,
				startedAt: atMs - event.ms,
				...fields,
			})
			.onConflictDoUpdate({ target: [jobs.projectId, jobs.id], set: fields })
			.run();
		const job = this.#job(tx, event.jobId);
		if (job?.callId) this.#absorbJob(tx, job, atMs);
	}

	// Un paso de un lote que acaba de terminar. Upsert por (job_id, step_index): si un paso se reporta más de
	// una vez (reintento, reanudación), el último build_step_finished manda y se actualiza en su sitio.
	#buildStepFinished(tx: Tx, event: BuildStepFinished): void {
		const error = event.error;
		const fields = {
			file: event.file,
			status: event.status,
			ms: event.ms,
			touchedCount: event.touchedCount,
			errorType: error?.type ?? null,
			errorMessage: error?.message ?? null,
			nextStep: error?.nextStep ?? null,
			errorLine: error?.line ?? null,
			warning: event.warning ?? null,
			resultJson: event.result?.kind === "inline" ? event.result.json : null,
			resultPath: event.result?.kind === "file" ? event.result.path : null,
			resultBytes: event.result?.kind === "file" ? event.result.bytes : null,
		};
		tx.insert(buildSteps)
			.values({
				projectId: this.#projectId,
				jobId: event.jobId,
				stepIndex: event.index,
				...fields,
			})
			.onConflictDoUpdate({
				target: [buildSteps.projectId, buildSteps.jobId, buildSteps.stepIndex],
				set: fields,
			})
			.run();
	}

	// Los nodos y el error de un job cuentan para la llamada que lo lanzó (se ven y se buscan en ella)
	#absorbJob(tx: Tx, job: JobRow, atMs: number): void {
		if (job.callId === null) return;
		const call = this.#call(tx, job.callId);
		if (call === undefined) return;
		this.#touchNodes(tx, call, parseJson<string[]>(job.touchedJson), atMs);
		const now = this.#call(tx, call.callId);
		if (now === undefined) return;
		const extra = [now.extraText, job.errorMessage ?? ""]
			.filter((part) => part !== "")
			.join(TEXT_SEPARATOR);
		tx.update(calls)
			.set({ extraText: extra, summary: summaryOf(now, job) })
			.where(this.#own(calls, eq(calls.callId, call.callId)))
			.run();
	}

	// Enlaza los nodos con la llamada y acumula su resumen por nodo; solo cuentan los que eran nuevos para ella
	#touchNodes(
		tx: Tx,
		call: CallRow,
		nodeIds: readonly string[],
		atMs: number,
	): void {
		const fileUrl =
			tx
				.select({ fileUrl: sessions.fileUrl })
				.from(sessions)
				.where(this.#own(sessions, eq(sessions.id, call.sessionId)))
				.get()?.fileUrl ?? null;
		const added: string[] = [];
		for (const nodeId of new Set(nodeIds)) {
			const linked = tx
				.insert(callNodes)
				.values({
					projectId: this.#projectId,
					callId: call.callId,
					nodeId,
				})
				.onConflictDoNothing()
				.run();
			if (linked.changes === 0) continue;
			added.push(nodeId);
			tx.insert(nodesTouched)
				.values({
					projectId: this.#projectId,
					nodeId,
					fileUrl,
					firstAt: atMs,
					lastAt: atMs,
					touchCount: 1,
					lastSessionId: call.sessionId,
					lastCallId: call.callId,
				})
				.onConflictDoUpdate({
					target: [nodesTouched.projectId, nodesTouched.nodeId],
					set: {
						fileUrl,
						lastAt: sql`max(${nodesTouched.lastAt}, ${atMs})`,
						touchCount: sql`${nodesTouched.touchCount} + 1`,
						lastSessionId: call.sessionId,
						lastCallId: call.callId,
					},
				})
				.run();
		}
		tx.update(calls)
			.set({
				touchedCount: sql`${calls.touchedCount} + ${added.length}`,
				extraText: sql`trim(${calls.extraText} || ${added.length > 0 ? ` ${added.join(TEXT_SEPARATOR)}` : ""})`,
			})
			.where(this.#own(calls, eq(calls.callId, call.callId)))
			.run();
	}
}
