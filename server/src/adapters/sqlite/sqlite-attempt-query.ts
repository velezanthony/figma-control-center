// Lecturas del historial de intentos: objetivos, intentos con lo que cambió, los de una llamada
// y el contenido de un papel. Solo lectura y siempre dentro del proyecto; las llama SqliteHistoryQuery

import { gunzipSync } from "node:zlib";
import { and, asc, desc, eq, gte, inArray, type SQL, sql } from "drizzle-orm";
import type { HistoryQuery, Rows } from "#application/ports/history-query.ts";
import {
	type AssetRecord,
	type AttemptItem,
	type AttemptKind,
	type AttemptScriptItem,
	type AttemptSummary,
	type AttemptTarget,
	changedRoles,
	type ScriptLookup,
	type ScriptSelector,
	type StoredScript,
} from "#domain/attempt.ts";
import type { FigmaDb } from "./database.ts";
import { attemptScripts, attempts, calls, scriptBlobs } from "./schema.ts";

type AttemptRow = typeof attempts.$inferSelect;

const iso = (ms: number): string => new Date(ms).toISOString();

// Condiciones comunes: el proyecto va primero, siempre. `instr` y no LIKE: un «%» o «_» del objetivo no son comodines
const filters = (
	projectId: number,
	q: {
		readonly target: string | null;
		readonly kind: AttemptKind | null;
		readonly sinceMs: number | null;
	},
): SQL[] => [
	eq(attempts.projectId, projectId),
	...(q.target !== null && q.target !== ""
		? [sql`instr(${attempts.target}, ${q.target}) > 0`]
		: []),
	...(q.kind !== null ? [eq(attempts.kind, q.kind)] : []),
	...(q.sinceMs !== null ? [gte(attempts.startedAt, q.sinceMs)] : []),
];

type TargetsQuery = Parameters<HistoryQuery["attemptTargets"]>[0];
type TargetAttemptsQuery = Parameters<HistoryQuery["targetAttempts"]>[0];

// Objetivos con su número de intentos y cómo acabó el último: UNA consulta (grupos unidos a su último intento por el
// índice único), no una por objetivo
function attemptTargets(
	db: FigmaDb,
	projectId: number,
	q: TargetsQuery,
): Rows<AttemptTarget> {
	const where = and(...filters(projectId, q)) as SQL;
	const g = db
		.select({
			kind: attempts.kind,
			target: attempts.target,
			count: sql<number>`count(*)`.as("count"),
			lastN: sql<number>`max(${attempts.n})`.as("last_n"),
			lastAt: sql<number>`max(${attempts.startedAt})`.as("last_at"),
		})
		.from(attempts)
		.where(where)
		.groupBy(attempts.kind, attempts.target)
		.as("g");
	const onLast = and(
		eq(attempts.projectId, projectId),
		eq(attempts.kind, g.kind),
		eq(attempts.target, g.target),
		eq(attempts.n, g.lastN),
	);
	const byStatus =
		q.status !== undefined && q.status !== null
			? eq(attempts.status, q.status)
			: undefined;
	const dir = q.dir === "asc" ? asc : desc;
	const order =
		q.order === "last"
			? [dir(g.lastAt), desc(g.count), asc(g.target)]
			: [dir(g.count), desc(g.lastAt), asc(g.target)];
	const rows = db
		.select({
			kind: g.kind,
			target: g.target,
			count: g.count,
			lastAt: g.lastAt,
			status: attempts.status,
		})
		.from(g)
		.innerJoin(attempts, onLast)
		.where(byStatus)
		.orderBy(...order)
		.limit(q.limit)
		.offset(q.offset ?? 0)
		.all();
	const total =
		db
			.select({ n: sql<number>`count(*)` })
			.from(g)
			.innerJoin(attempts, onLast)
			.where(byStatus)
			.get()?.n ?? 0;
	return {
		items: rows.map(
			(r): AttemptTarget => ({
				kind: r.kind,
				target: r.target,
				attempts: Number(r.count),
				lastStatus: r.status,
				lastAt: iso(Number(r.lastAt)),
			}),
		),
		total: Number(total),
	};
}

const summaryOf = (row: AttemptRow): AttemptSummary => ({
	id: row.id,
	n: row.n,
	kind: row.kind,
	target: row.target,
	status: row.status,
});

// Los contenidos de varios intentos con su tamaño y cómo se guardaron
function scriptsOf(
	db: FigmaDb,
	projectId: number,
	ids: readonly number[],
): Map<number, AttemptScriptItem[]> {
	const out = new Map<number, AttemptScriptItem[]>();
	if (ids.length === 0) return out;
	const rows = db
		.select({
			attemptId: attemptScripts.attemptId,
			role: attemptScripts.role,
			path: attemptScripts.path,
			sha256: attemptScripts.sha256,
			bytes: scriptBlobs.bytes,
			stored: scriptBlobs.stored,
		})
		.from(attemptScripts)
		.leftJoin(
			scriptBlobs,
			and(
				eq(scriptBlobs.projectId, attemptScripts.projectId),
				eq(scriptBlobs.sha256, attemptScripts.sha256),
			),
		)
		.where(
			and(
				eq(attemptScripts.projectId, projectId),
				inArray(attemptScripts.attemptId, [...ids]),
			),
		)
		.orderBy(
			asc(attemptScripts.attemptId),
			asc(attemptScripts.role),
			asc(attemptScripts.path),
		)
		.all();
	for (const row of rows) {
		const list = out.get(row.attemptId) ?? [];
		list.push({
			role: row.role,
			path: row.path,
			sha256: row.sha256,
			bytes: row.bytes ?? 0,
			stored: row.stored ?? "too_big",
		});
		out.set(row.attemptId, list);
	}
	return out;
}

// Filas de intentos a items: lo que cambió respecto al anterior del mismo objetivo (aunque quede fuera de las filas), los
// contenidos y si su llamada sigue en el histórico
function toItems(
	db: FigmaDb,
	projectId: number,
	rows: readonly AttemptRow[],
): AttemptItem[] {
	const key = (r: { kind: string; target: string; n: number }) =>
		`${r.kind}\u0000${r.target}\u0000${r.n}`;
	const known = new Map(rows.map((r) => [key(r), r]));
	// Solo se piden los anteriores que no vienen ya entre las filas
	const previous = new Map<number, AttemptRow>();
	for (const row of rows) {
		const prev =
			known.get(key({ ...row, n: row.n - 1 })) ??
			db
				.select()
				.from(attempts)
				.where(
					and(
						eq(attempts.projectId, projectId),
						eq(attempts.kind, row.kind),
						eq(attempts.target, row.target),
						eq(attempts.n, row.n - 1),
					),
				)
				.get();
		if (prev !== undefined) previous.set(row.id, prev);
	}
	const scripts = scriptsOf(db, projectId, [
		...new Set([...rows, ...previous.values()].map((r) => r.id)),
	]);
	const callIds = rows.flatMap((r) => (r.callId === null ? [] : [r.callId]));
	const kept = new Set(
		callIds.length === 0
			? []
			: db
					.select({ callId: calls.callId })
					.from(calls)
					.where(
						and(
							eq(calls.projectId, projectId),
							inArray(calls.callId, [...new Set(callIds)]),
						),
					)
					.all()
					.map((r) => r.callId),
	);
	return rows.map((row): AttemptItem => {
		const prev = previous.get(row.id);
		const mine = scripts.get(row.id) ?? [];
		return {
			...summaryOf(row),
			firstError: row.firstError,
			callId: row.callId,
			jobId: row.jobId,
			stepIndex: row.stepIndex,
			startedAt: iso(row.startedAt),
			finishedAt: iso(row.finishedAt),
			kit: row.kit,
			kitSha256: row.kitSha256,
			assets:
				row.assetsJson === null
					? []
					: (JSON.parse(row.assetsJson) as AssetRecord[]),
			scripts: mine,
			changed:
				prev === undefined
					? null
					: changedRoles(scripts.get(prev.id) ?? [], mine),
			callKept: row.callId !== null && kept.has(row.callId),
		};
	});
}

// Los intentos de los objetivos que contienen `target`, en orden (los `limit` últimos de cada consulta)
function attemptsOfTarget(
	db: FigmaDb,
	projectId: number,
	q: {
		readonly target: string;
		readonly kind: AttemptKind | null;
		readonly sinceMs: number | null;
		readonly limit: number;
	},
): Rows<AttemptItem> {
	const where = and(...filters(projectId, q)) as SQL;
	const total =
		db.select({ n: sql<number>`count(*)` }).from(attempts).where(where).get()
			?.n ?? 0;
	const latest = db
		.select()
		.from(attempts)
		.where(where)
		.orderBy(desc(attempts.startedAt), desc(attempts.id))
		.limit(q.limit)
		.all()
		.sort((a, b) =>
			a.kind === b.kind && a.target === b.target
				? a.n - b.n
				: `${a.kind}\u0000${a.target}`.localeCompare(
						`${b.kind}\u0000${b.target}`,
					),
		);
	return { items: toItems(db, projectId, latest), total: Number(total) };
}

// Los intentos de UN objetivo exacto, en orden de n; `offset` null da los últimos `limit`
function attemptsOfExactTarget(
	db: FigmaDb,
	projectId: number,
	q: TargetAttemptsQuery,
): Rows<AttemptItem> {
	const where = and(
		eq(attempts.projectId, projectId),
		eq(attempts.kind, q.kind),
		eq(attempts.target, q.target),
	);
	const total = Number(
		db.select({ n: sql<number>`count(*)` }).from(attempts).where(where).get()
			?.n ?? 0,
	);
	const offset = q.offset ?? Math.max(0, total - q.limit);
	const rows = db
		.select()
		.from(attempts)
		.where(where)
		.orderBy(asc(attempts.n))
		.limit(q.limit)
		.offset(offset)
		.all();
	return { items: toItems(db, projectId, rows), total };
}

function attemptById(
	db: FigmaDb,
	projectId: number,
	id: number,
): AttemptItem | null {
	const row = db
		.select()
		.from(attempts)
		.where(and(eq(attempts.projectId, projectId), eq(attempts.id, id)))
		.get();
	return row === undefined ? null : (toItems(db, projectId, [row])[0] ?? null);
}

function attemptsOfCall(
	db: FigmaDb,
	projectId: number,
	callId: string,
): readonly AttemptSummary[] {
	return db
		.select()
		.from(attempts)
		.where(and(eq(attempts.projectId, projectId), eq(attempts.callId, callId)))
		.orderBy(asc(attempts.id))
		.all()
		.map(summaryOf);
}

const toStored = (row: {
	sha256: string;
	kind: StoredScript["kind"];
	bytes: number;
	stored: StoredScript["stored"];
	content: Buffer | null;
}): StoredScript => ({
	sha256: row.sha256,
	kind: row.kind,
	bytes: row.bytes,
	stored: row.stored,
	content:
		row.stored === "full" && row.content !== null
			? gunzipSync(row.content).toString("utf8")
			: null,
});

function storedScript(
	db: FigmaDb,
	projectId: number,
	selector: ScriptSelector,
): ScriptLookup {
	let sha256: string;
	if (selector.by === "sha256") {
		sha256 = selector.sha256;
	} else {
		const refs = db
			.select({ path: attemptScripts.path, sha256: attemptScripts.sha256 })
			.from(attemptScripts)
			.where(
				and(
					eq(attemptScripts.projectId, projectId),
					eq(attemptScripts.attemptId, selector.attemptId),
					eq(attemptScripts.role, selector.role),
				),
			)
			.orderBy(asc(attemptScripts.path))
			.all();
		if (refs.length === 0) return { kind: "not_found" };
		const chosen =
			selector.path === undefined
				? refs.length === 1
					? refs[0]
					: undefined
				: refs.find((r) => r.path === selector.path);
		if (chosen === undefined) {
			return selector.path === undefined
				? { kind: "needs_path", paths: refs.map((r) => r.path) }
				: { kind: "not_found" };
		}
		sha256 = chosen.sha256;
	}
	const row = db
		.select()
		.from(scriptBlobs)
		.where(
			and(eq(scriptBlobs.projectId, projectId), eq(scriptBlobs.sha256, sha256)),
		)
		.get();
	return row === undefined
		? { kind: "not_found" }
		: { kind: "found", script: toStored(row) };
}

type AttemptsQuery = Parameters<typeof attemptsOfTarget>[2];

// Las lecturas del historial de intentos de UN proyecto: SqliteHistoryQuery delega aquí. Solo lee, y el motor lo
// garantiza si la conexión es de solo consulta
export class SqliteAttemptQuery {
	readonly #db: FigmaDb;
	readonly #projectId: number;

	constructor(options: { readonly db: FigmaDb; readonly projectId: number }) {
		this.#db = options.db;
		this.#projectId = options.projectId;
	}

	targets(query: TargetsQuery): Rows<AttemptTarget> {
		return attemptTargets(this.#db, this.#projectId, query);
	}

	attempts(query: AttemptsQuery): Rows<AttemptItem> {
		return attemptsOfTarget(this.#db, this.#projectId, query);
	}

	targetAttempts(query: TargetAttemptsQuery): Rows<AttemptItem> {
		return attemptsOfExactTarget(this.#db, this.#projectId, query);
	}

	byId(id: number): AttemptItem | null {
		return attemptById(this.#db, this.#projectId, id);
	}

	ofCall(callId: string): readonly AttemptSummary[] {
		return attemptsOfCall(this.#db, this.#projectId, callId);
	}

	script(selector: ScriptSelector): ScriptLookup {
		return storedScript(this.#db, this.#projectId, selector);
	}
}
