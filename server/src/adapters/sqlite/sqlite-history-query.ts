import {
	and,
	asc,
	count,
	countDistinct,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lte,
	type SQL,
	sql,
} from "drizzle-orm";
import type { HistoryQuery, Rows } from "#application/ports/history-query.ts";
import type {
	AttemptItem,
	AttemptKind,
	AttemptSummary,
	AttemptTarget,
	ScriptLookup,
	ScriptSelector,
} from "#domain/attempt.ts";
import type {
	BuildStepFullResult,
	CallItem,
	CallsPage,
	CallsQuery,
	CaptureItem,
	ConnectionStatus,
	ErrorGroup,
	HistoryError,
	HistorySummary,
	JobInfo,
	NodeTouch,
	ResolvedRange,
	ScreenshotInfo,
	SessionItem,
	SortKey,
	StoredBuildStep,
} from "#domain/history.ts";
import { RAN_IN_TAB_ERROR_TYPES, TOOL_NAME } from "#domain/tool-names.ts";
import type { FigmaDb } from "./database.ts";
import { toFtsQuery } from "./fts-query.ts";
import {
	buildSteps,
	callNodes,
	calls,
	captures,
	events,
	jobs,
	sessions,
} from "./schema.ts";
import { SqliteAttemptQuery } from "./sqlite-attempt-query.ts";

const P95 = 0.95;
const ERROR_EXAMPLES = 3;
const STATUS_CHECKED = "status_checked";
const UNKNOWN_ERROR = "desconocido";

const iso = (ms: number): string => new Date(ms).toISOString();
const num = (value: unknown): number => Number(value ?? 0);

// Los fragmentos base se construyen con el proyecto DENTRO: cada tabla unida se filtra por él en el JOIN y la cláusula
// WHERE de cada consulta lo lleva siempre (`whereOf`, `whereSessions`). Sin `projectId` no hay forma de escribir una
// consulta del histórico, así que olvidar el filtro no compila.
// Llamadas con su job (si lanzaron uno): la unidad que se lista, filtra y ordena
const jobOfCall = (projectId: number): SQL =>
	and(eq(jobs.projectId, projectId), eq(jobs.callId, calls.callId)) as SQL;
const sessionOfCall = (projectId: number): SQL =>
	and(
		eq(sessions.projectId, projectId),
		eq(sessions.id, calls.sessionId),
	) as SQL;
const callOfNode = and(
	eq(calls.projectId, callNodes.projectId),
	eq(calls.callId, callNodes.callId),
) as SQL;
// coalesce: sin job, `jobs.status` es NULL y NOT NULL tampoco es verdadero
const HAS_ERROR = sql`(${calls.status} = 'error' OR coalesce(${jobs.status}, '') = 'failed')`;
const IS_RUNNING = sql`(${calls.status} = 'running' OR coalesce(${jobs.status}, '') = 'running')`;
// Mismo criterio que `ranInTab`: escrituras que llegaron a la pestaña (bien, o fallo posterior al envío)
const RAN_IN_TAB = sql`(${calls.isWrite} = 1 AND ${calls.tool} <> ${TOOL_NAME.cancelJob} AND (${calls.status} = 'ok' OR ${calls.errorType} IN (${sql.join(
	RAN_IN_TAB_ERROR_TYPES.map((t) => sql`${t}`),
	sql`, `,
)})))`;
const STATUS_RANK = sql`CASE WHEN ${HAS_ERROR} THEN 0 WHEN ${IS_RUNNING} THEN 1 ELSE 2 END`;
const countWhen = (condition: SQL) =>
	sql<number | null>`sum(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
const TIE_BREAK = [desc(calls.startedAt), desc(calls.callId)];

const rangeConditions = (range: ResolvedRange): SQL[] => [
	...(range.fromMs !== null ? [gte(calls.startedAt, range.fromMs)] : []),
	...(range.toMs !== null ? [lte(calls.startedAt, range.toMs)] : []),
	...(range.sessionId !== null ? [eq(calls.sessionId, range.sessionId)] : []),
];

// WHERE sobre las llamadas: el proyecto va primero, siempre
const whereOf = (projectId: number, conditions: readonly SQL[]): SQL =>
	and(eq(calls.projectId, projectId), ...conditions) as SQL;

// WHERE sobre las sesiones
const whereSessions = (projectId: number, conditions: readonly SQL[]): SQL =>
	and(eq(sessions.projectId, projectId), ...conditions) as SQL;

function orderOf(key: SortKey, dir: "asc" | "desc", jobsOnly: boolean): SQL[] {
	const d = dir === "asc" ? asc : desc;
	switch (key) {
		case "time":
			// En la pantalla de jobs, los que siguen en curso van siempre arriba
			return jobsOnly
				? [
						sql`(${jobs.status} = 'running') DESC`,
						d(calls.startedAt),
						d(calls.callId),
					]
				: [d(calls.startedAt), d(calls.callId)];
		case "tool":
			return [d(calls.tool), ...TIE_BREAK];
		case "status":
			return [d(STATUS_RANK), ...TIE_BREAK];
		case "duration":
			return [sql`${calls.ms} IS NULL`, d(calls.ms), ...TIE_BREAK];
		case "nodes":
			return [d(calls.touchedCount), ...TIE_BREAK];
		case "session":
			return [d(calls.sessionId), ...TIE_BREAK];
	}
}

// Lo que se lee de cada llamada (con su sesión y su job)
const CALL_COLUMNS = {
	callId: calls.callId,
	sessionId: calls.sessionId,
	fileUrl: sessions.fileUrl,
	startedAt: calls.startedAt,
	tool: calls.tool,
	status: calls.status,
	ms: calls.ms,
	errorType: calls.errorType,
	errorMessage: calls.errorMessage,
	nextStep: calls.nextStep,
	errorLine: calls.errorLine,
	retryable: calls.retryable,
	jobId: calls.jobId,
	argsSummary: calls.argsSummary,
	resultPath: calls.resultPath,
	summary: calls.summary,
	jobStatus: jobs.status,
	jobMs: jobs.ms,
	jobErrorType: jobs.errorType,
	jobErrorMessage: jobs.errorMessage,
	jobNextStep: jobs.nextStep,
	jobErrorLine: jobs.errorLine,
	jobTouchedJson: jobs.touchedJson,
};

// Las llamadas (con su sesión y su job) que cumplen las condiciones, siempre dentro del proyecto
const callsQuery = (
	db: FigmaDb,
	projectId: number,
	conditions: readonly SQL[],
) =>
	db
		.select(CALL_COLUMNS)
		.from(calls)
		.leftJoin(jobs, jobOfCall(projectId))
		.innerJoin(sessions, sessionOfCall(projectId))
		.where(whereOf(projectId, conditions))
		.$dynamic();
type CallRow = ReturnType<ReturnType<typeof callsQuery>["all"]>[number];

type Page = {
	readonly order: readonly SQL[];
	readonly limit: number;
	readonly offset: number;
};

// Solo lee, y el motor lo garantiza si la conexión es de solo consulta (database.ts). Sin métodos que escriban
export class SqliteHistoryQuery implements HistoryQuery {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #attempts: SqliteAttemptQuery;

	constructor(options: { readonly db: FigmaDb; readonly projectId: number }) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#attempts = new SqliteAttemptQuery(options);
	}

	summary(range: ResolvedRange, topTools: number): HistorySummary {
		const p = this.#projectId;
		const where = whereOf(p, rangeConditions(range));
		const totals = this.#db
			.select({
				calls: count(),
				writes: countWhen(RAN_IN_TAB),
				errors: countWhen(HAS_ERROR),
				running: countWhen(IS_RUNNING),
				jobs: count(jobs.id),
				meanMs: sql<number | null>`avg(${calls.ms})`,
				timed: count(calls.ms),
			})
			.from(calls)
			.leftJoin(jobs, jobOfCall(p))
			.where(where)
			.get();
		const timed = num(totals?.timed);
		const p95 =
			timed === 0
				? null
				: (this.#db
						.select({ ms: calls.ms })
						.from(calls)
						.where(whereOf(p, [...rangeConditions(range), isNotNull(calls.ms)]))
						.orderBy(calls.ms)
						.limit(1)
						.offset(Math.max(0, Math.ceil(P95 * timed) - 1))
						.get()?.ms ?? null);
		const nodes = this.#db
			.select({ n: countDistinct(callNodes.nodeId) })
			.from(callNodes)
			.innerJoin(calls, callOfNode)
			.where(where)
			.get();
		const tools = this.#db
			.select({
				tool: calls.tool,
				calls: count(),
				errors: countWhen(HAS_ERROR),
			})
			.from(calls)
			.leftJoin(jobs, jobOfCall(p))
			.where(where)
			.groupBy(calls.tool)
			.orderBy(desc(count()), calls.tool)
			.limit(topTools)
			.all();
		return {
			range,
			calls: num(totals?.calls),
			writes: num(totals?.writes),
			errors: num(totals?.errors),
			running: num(totals?.running),
			meanMs: totals?.meanMs ?? null,
			p95Ms: p95,
			jobs: num(totals?.jobs),
			nodesTouched: num(nodes?.n),
			topTools: tools.map((t) => ({
				tool: t.tool,
				calls: num(t.calls),
				errors: num(t.errors),
			})),
		};
	}

	errors(range: ResolvedRange, limit: number): Rows<ErrorGroup> {
		const p = this.#projectId;
		const conditions = rangeConditions(range);
		// Los errores son los de las llamadas y los de los jobs que lanzaron
		const errs = sql`
			SELECT coalesce(${calls.errorType}, ${UNKNOWN_ERROR}) AS type, coalesce(${calls.errorMessage}, '') AS message,
				${calls.nextStep} AS next_step, ${calls.callId} AS call_id, ${calls.tool} AS tool, ${calls.startedAt} AS at
			FROM ${calls} WHERE ${whereOf(p, [...conditions, eq(calls.status, "error")])}
			UNION ALL
			SELECT coalesce(${jobs.errorType}, ${UNKNOWN_ERROR}), coalesce(${jobs.errorMessage}, ''),
				${jobs.nextStep}, ${calls.callId}, ${calls.tool}, ${calls.startedAt}
			FROM ${jobs} JOIN ${calls} ON ${calls.projectId} = ${jobs.projectId} AND ${calls.callId} = ${jobs.callId}
			WHERE ${whereOf(p, [...conditions, eq(jobs.status, "failed")])}`;
		const groups = this.#db.all<{
			type: string;
			count: number;
			last_at: number;
			next_step: string | null;
		}>(sql`
			WITH errs AS (${errs})
			SELECT type, count(*) AS count, max(at) AS last_at, next_step
			FROM errs GROUP BY type ORDER BY count DESC, last_at DESC LIMIT ${limit}`);
		const total = this.#db.get<{ n: number }>(sql`
			WITH errs AS (${errs}) SELECT count(DISTINCT type) AS n FROM errs`);
		const items = groups.map(
			(g): ErrorGroup => ({
				type: g.type,
				count: num(g.count),
				lastAt: iso(g.last_at),
				nextStep: g.next_step,
				examples: this.#db
					.all<{
						call_id: string;
						tool: string;
						at: number;
						message: string;
					}>(sql`
					WITH errs AS (${errs})
					SELECT call_id, tool, at, message FROM errs WHERE type = ${g.type}
					ORDER BY at DESC LIMIT ${ERROR_EXAMPLES}`)
					.map((e) => ({
						callId: e.call_id,
						tool: e.tool,
						at: iso(e.at),
						message: e.message,
					})),
			}),
		);
		return { items, total: num(total?.n) };
	}

	nodes(range: ResolvedRange, limit: number): Rows<NodeTouch> {
		const where = whereOf(this.#projectId, rangeConditions(range));
		// Con un solo max(), SQLite toma las columnas sueltas de la fila que lo da: la última llamada
		const rows = this.#db.all<{
			node_id: string;
			touches: number;
			last_at: number;
			last_call_id: string;
			last_tool: string;
		}>(sql`
			SELECT ${callNodes.nodeId} AS node_id, count(*) AS touches, max(${calls.startedAt}) AS last_at,
				${calls.callId} AS last_call_id, ${calls.tool} AS last_tool
			FROM ${callNodes} JOIN ${calls} ON ${callOfNode} WHERE ${where}
			GROUP BY ${callNodes.nodeId} ORDER BY last_at DESC, ${callNodes.nodeId} LIMIT ${limit}`);
		const total = this.#db
			.select({ n: countDistinct(callNodes.nodeId) })
			.from(callNodes)
			.innerJoin(calls, callOfNode)
			.where(where)
			.get();
		return {
			items: rows.map((r) => ({
				nodeId: r.node_id,
				touches: num(r.touches),
				lastAt: iso(r.last_at),
				lastCallId: r.last_call_id,
				lastTool: r.last_tool,
			})),
			total: num(total?.n),
		};
	}

	sessions(range: ResolvedRange, limit: number): Rows<SessionItem> {
		// Una sesión entra si estuvo viva dentro del rango; sus contadores son los de toda su vida
		const conditions: SQL[] = [
			...(range.fromMs !== null
				? [gte(sessions.lastSeenAt, range.fromMs)]
				: []),
			...(range.toMs !== null ? [lte(sessions.startedAt, range.toMs)] : []),
			...(range.sessionId !== null ? [eq(sessions.id, range.sessionId)] : []),
		];
		const where = whereSessions(this.#projectId, conditions);
		const rows = this.#db
			.select()
			.from(sessions)
			.where(where)
			.orderBy(desc(sessions.lastSeenAt), sessions.id)
			.limit(limit)
			.all();
		const total = this.#db
			.select({ n: count() })
			.from(sessions)
			.where(where)
			.get();
		return {
			items: rows.map((s) => ({
				sessionId: s.id,
				pid: s.pid,
				fileUrl: s.fileUrl,
				startedAt: iso(s.startedAt),
				lastSeenAt: iso(s.lastSeenAt),
				calls: num(s.calls),
				writes: num(s.writes),
				errors: num(s.errors),
				totalMs: num(s.totalMs),
			})),
			total: num(total?.n),
		};
	}

	calls(query: CallsQuery): Omit<CallsPage, "truncated"> {
		const conditions: SQL[] = [...rangeConditions(query.range)];
		if (query.tool !== null) conditions.push(eq(calls.tool, query.tool));
		if (query.status === "error") conditions.push(HAS_ERROR);
		if (query.status === "running") conditions.push(IS_RUNNING);
		if (query.status === "ok")
			conditions.push(sql`NOT ${HAS_ERROR} AND NOT ${IS_RUNNING}`);
		if (query.jobsOnly) conditions.push(isNotNull(jobs.id));
		const fts = toFtsQuery(query.search);
		if (fts !== null) {
			conditions.push(
				sql`${calls}.rowid IN (SELECT rowid FROM calls_fts WHERE calls_fts MATCH ${fts})`,
			);
		}
		const p = this.#projectId;
		const where = whereOf(p, conditions);
		const order = orderOf(query.sort.key, query.sort.dir, query.jobsOnly);

		const total = num(
			this.#db
				.select({ n: count() })
				.from(calls)
				.leftJoin(jobs, jobOfCall(p))
				.where(where)
				.get()?.n,
		);
		const pageCount = Math.max(1, Math.ceil(total / query.perPage));
		let page = query.page;
		if (query.locate !== null) {
			const found = this.#db.get<{ rn: number }>(sql`
				SELECT rn FROM (
					SELECT ${calls.callId} AS call_id, row_number() OVER (ORDER BY ${sql.join(order, sql`, `)}) AS rn
					FROM ${calls} LEFT JOIN ${jobs} ON ${jobOfCall(p)} WHERE ${where}
				) WHERE call_id = ${query.locate}`);
			if (found !== undefined) page = Math.ceil(num(found.rn) / query.perPage);
		}
		page = Math.min(pageCount, Math.max(1, page));

		const rows = this.#selectCalls(conditions, {
			order,
			limit: query.perPage,
			offset: (page - 1) * query.perPage,
		});
		return { items: this.#hydrate(rows), total, page, perPage: query.perPage };
	}

	call(callId: string): CallItem | null {
		const rows = this.#selectCalls([eq(calls.callId, callId)]);
		return this.#hydrate(rows)[0] ?? null;
	}

	steps(jobId: string): readonly StoredBuildStep[] {
		const rows = this.#db
			.select()
			.from(buildSteps)
			.where(
				and(
					eq(buildSteps.projectId, this.#projectId),
					eq(buildSteps.jobId, jobId),
				),
			)
			.orderBy(buildSteps.stepIndex)
			.all();
		return rows.map((r) => ({
			index: r.stepIndex,
			file: r.file,
			status: r.status,
			ms: r.ms,
			touchedCount: num(r.touchedCount),
			error: errorOf(r.errorType, r.errorMessage, r.nextStep, r.errorLine),
			warning: r.warning,
			result: resultOf(r.resultJson, r.resultPath, r.resultBytes),
		}));
	}

	attemptTargets(
		query: Parameters<HistoryQuery["attemptTargets"]>[0],
	): Rows<AttemptTarget> {
		return this.#attempts.targets(query);
	}

	targetAttempts(
		query: Parameters<HistoryQuery["targetAttempts"]>[0],
	): Rows<AttemptItem> {
		return this.#attempts.targetAttempts(query);
	}

	attemptById(id: number): AttemptItem | null {
		return this.#attempts.byId(id);
	}

	attempts(query: {
		readonly target: string;
		readonly kind: AttemptKind | null;
		readonly sinceMs: number | null;
		readonly limit: number;
	}): Rows<AttemptItem> {
		return this.#attempts.attempts(query);
	}

	attemptsOfCall(callId: string): readonly AttemptSummary[] {
		return this.#attempts.ofCall(callId);
	}

	storedScript(selector: ScriptSelector): ScriptLookup {
		return this.#attempts.script(selector);
	}

	captures(page: number, perPage: number): Rows<CaptureItem> {
		const ofProject = eq(captures.projectId, this.#projectId);
		const total = this.#db
			.select({ n: count() })
			.from(captures)
			.where(ofProject)
			.get();
		const rows = this.#db
			.select({
				callId: captures.callId,
				nodeId: captures.nodeId,
				path: captures.path,
				width: captures.width,
				height: captures.height,
			})
			.from(captures)
			.where(ofProject)
			.orderBy(desc(captures.at), desc(sql`${captures}.rowid`))
			.limit(perPage)
			.offset((Math.max(1, page) - 1) * perPage)
			.all();
		const byCall = new Map(
			this.#hydrate(
				this.#selectCalls([
					inArray(calls.callId, [...new Set(rows.map((r) => r.callId))]),
				]),
			).map((c) => [c.callId, c]),
		);
		const items = rows.flatMap((r) => {
			const call = byCall.get(r.callId);
			return call === undefined
				? []
				: [
						{
							call,
							shot: {
								nodeId: r.nodeId,
								path: r.path,
								width: r.width,
								height: r.height,
							},
						},
					];
		});
		return { items, total: num(total?.n) };
	}

	lastStatus(): ConnectionStatus | null {
		const row = this.#db
			.select({ payload: events.payload })
			.from(events)
			.where(
				and(
					eq(events.projectId, this.#projectId),
					eq(events.type, STATUS_CHECKED),
				),
			)
			.orderBy(desc(events.id))
			.limit(1)
			.get();
		if (row === undefined) return null;
		const e = JSON.parse(row.payload) as ConnectionStatus & { at: string };
		return {
			at: e.at,
			chromeReachable: e.chromeReachable,
			tabFound: e.tabFound,
			figmaReady: e.figmaReady,
			fileName: e.fileName,
			pageName: e.pageName,
		};
	}

	#selectCalls(conditions: readonly SQL[], page?: Page): CallRow[] {
		const query = callsQuery(this.#db, this.#projectId, conditions);
		return page === undefined
			? query.all()
			: query
					.orderBy(...page.order)
					.limit(page.limit)
					.offset(page.offset)
					.all();
	}

	// Añade a cada fila lo que vive en otras tablas (nodos y capturas) con una consulta por tabla, no por fila
	#hydrate(rows: readonly CallRow[]): CallItem[] {
		if (rows.length === 0) return [];
		const ids = rows.map((r) => r.callId);
		const nodes = new Map<string, string[]>();
		for (const r of this.#db
			.select({ callId: callNodes.callId, nodeId: callNodes.nodeId })
			.from(callNodes)
			.where(
				and(
					eq(callNodes.projectId, this.#projectId),
					inArray(callNodes.callId, ids),
				),
			)
			.orderBy(sql`${callNodes}.rowid`)
			.all()) {
			nodes.set(r.callId, [...(nodes.get(r.callId) ?? []), r.nodeId]);
		}
		const shots = new Map<string, ScreenshotInfo[]>();
		for (const r of this.#db
			.select({
				callId: captures.callId,
				nodeId: captures.nodeId,
				path: captures.path,
				width: captures.width,
				height: captures.height,
			})
			.from(captures)
			.where(
				and(
					eq(captures.projectId, this.#projectId),
					inArray(captures.callId, ids),
				),
			)
			.orderBy(captures.at, sql`${captures}.rowid`)
			.all()) {
			shots.set(r.callId, [
				...(shots.get(r.callId) ?? []),
				{ nodeId: r.nodeId, path: r.path, width: r.width, height: r.height },
			]);
		}
		return rows.map((r) =>
			toCallItem(r, nodes.get(r.callId) ?? [], shots.get(r.callId) ?? []),
		);
	}
}

function toCallItem(
	row: CallRow,
	nodeIds: readonly string[],
	screenshots: readonly ScreenshotInfo[],
): CallItem {
	const jobNodes: string[] =
		row.jobTouchedJson === null
			? []
			: (JSON.parse(row.jobTouchedJson) as string[]);
	const job: JobInfo | null =
		row.jobStatus === null
			? null
			: {
					status: row.jobStatus,
					ms: row.jobMs,
					error: errorOf(
						row.jobErrorType,
						row.jobErrorMessage,
						row.jobNextStep,
						row.jobErrorLine,
					),
					touchedNodeIds: jobNodes,
				};
	const own = new Set(jobNodes);
	return {
		callId: row.callId,
		sessionId: row.sessionId,
		fileUrl: row.fileUrl,
		tool: row.tool,
		startedAt: iso(row.startedAt),
		args: JSON.parse(row.argsSummary) as CallItem["args"],
		status: row.status,
		ms: row.ms,
		retryable: row.retryable,
		touchedNodeIds: nodeIds.filter((id) => !own.has(id)),
		error: errorOf(
			row.errorType,
			row.errorMessage,
			row.nextStep,
			row.errorLine,
		),
		resultPath: row.resultPath,
		jobId: row.jobId,
		job,
		screenshots,
		summary: row.summary,
	};
}

function resultOf(
	json: string | null,
	path: string | null,
	bytes: number | null,
): BuildStepFullResult | null {
	if (json !== null) return { kind: "inline", value: JSON.parse(json) };
	if (path !== null) return { kind: "file", path, bytes: bytes ?? 0 };
	return null;
}

function errorOf(
	type: string | null,
	message: string | null,
	nextStep: string | null,
	line: number | null,
): HistoryError | null {
	return type === null
		? null
		: { type, message: message ?? "", nextStep, line };
}
