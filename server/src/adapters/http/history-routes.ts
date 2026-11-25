import { z } from "zod";
import { makeAttemptDiff } from "#application/attempt-diff.ts";
import type { History, ListInput } from "#application/history.ts";
import type { HistoryUsageError } from "#application/history-range.ts";
import {
	ATTEMPT_KIND,
	ATTEMPT_ORDER,
	ATTEMPT_STATUS,
	type AttemptKind,
	type AttemptRole,
	describeChange,
} from "#domain/attempt.ts";
import type { RangeInput, SortKey, StatusFilter } from "#domain/history.ts";
import { limitHunks, limitText, toUnifiedDiff } from "#domain/text-diff.ts";
import { paramsOf, positiveIntParam } from "./input.ts";
import { HISTORY_ROUTE } from "./routes.ts";

// JSON, o un texto plano (el contenido o el diff enteros, que el navegador abre en otra pestaña)
export type HistoryResponse = {
	readonly status: number;
	readonly body?: unknown;
	readonly text?: string;
	readonly contentType?: string;
};

// Lo que el navegador recibe como mucho de un contenido o de un diff (el resto, con «Abrir completo»), el tope de
// trabajo del diff y las filas máximas de una página.
export const CONTENT_LINES = 2000;
export const DIFF_LINES = 2000;
export const DIFF_MAX_EDITS = 20_000;
export const PER_PAGE_MAX = 100;
const TEXT_TYPE = "text/plain; charset=utf-8";

const STATUS = Object.freeze({
	ok: 200,
	badRequest: 400,
	notFound: 404,
	conflict: 409,
} as const);

// Parámetros de la URL (espejo de web/src/lib/activity/endpoints.ts)
const PARAM = Object.freeze({
	preset: "preset",
	since: "since",
	until: "until",
	session: "session",
	limit: "limit",
	query: "q",
	tool: "tool",
	status: "status",
	jobs: "jobs",
	sort: "sort",
	dir: "dir",
	page: "page",
	perPage: "per",
	locate: "locate",
	kind: "kind",
	target: "target",
	role: "role",
	path: "path",
	from: "from",
	to: "to",
} as const);

const PRESETS = ["last_hour", "today"] as const satisfies readonly NonNullable<
	RangeInput["preset"]
>[];
const STATUSES = [
	"all",
	"ok",
	"error",
	"running",
] as const satisfies readonly StatusFilter[];
const SORT_KEYS = [
	"time",
	"tool",
	"status",
	"duration",
	"nodes",
	"session",
] as const satisfies readonly SortKey[];
const SORT_DIRS = ["asc", "desc"] as const;
const JOBS_ONLY = "1";
const DEFAULT_PAGE_SIZE = 25;

// Un parámetro que no se entiende cae en su valor por defecto: nunca es un 400
const presetParam = z.enum(PRESETS).optional().catch(undefined);
const limitParam = positiveIntParam.optional().catch(undefined);
const pageParam = positiveIntParam.catch(1);
const perPageParam = positiveIntParam.catch(DEFAULT_PAGE_SIZE);
const listParams = z.object({
	[PARAM.sort]: z.enum(SORT_KEYS).catch("time"),
	[PARAM.dir]: z.enum(SORT_DIRS).catch("desc"),
	[PARAM.status]: z.enum(STATUSES).catch("all"),
	[PARAM.page]: pageParam,
	[PARAM.perPage]: perPageParam,
});

const param = (p: URLSearchParams, name: string): string | undefined =>
	p.get(name) ?? undefined;

const rangeOf = (p: URLSearchParams): RangeInput => {
	const preset = presetParam.parse(param(p, PARAM.preset));
	return {
		...(preset !== undefined && { preset }),
		...(p.get(PARAM.since) !== null && { since: p.get(PARAM.since) as string }),
		...(p.get(PARAM.until) !== null && { until: p.get(PARAM.until) as string }),
		...(p.get(PARAM.session) !== null && {
			sessionId: p.get(PARAM.session) as string,
		}),
	};
};

const text = (body: string, status = STATUS.ok): HistoryResponse => ({
	status,
	text: body,
	contentType: TEXT_TYPE,
});

const conflict = (message: string): HistoryResponse => ({
	status: STATUS.conflict,
	body: { ok: false, error: { type: "Conflict", message } },
});

const failure = (error: HistoryUsageError): HistoryResponse => ({
	status: error.type === "NotFound" ? STATUS.notFound : STATUS.badRequest,
	body: { ok: false, error },
});

const success = (body: Record<string, unknown>): HistoryResponse => ({
	status: STATUS.ok,
	body: { ok: true, ...body },
});

type Outcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: HistoryUsageError };

const respond = <T>(
	outcome: Outcome<T>,
	present: (value: T) => Record<string, unknown>,
): HistoryResponse =>
	outcome.ok ? success(present(outcome.value)) : failure(outcome.error);

const asPage = (page: {
	items: readonly unknown[];
	total: number;
	truncated: boolean;
}) => ({
	items: page.items,
	total: page.total,
	truncated: page.truncated,
});

function listOf(p: URLSearchParams): ListInput {
	const list = listParams.parse(paramsOf(p));
	return {
		range: rangeOf(p),
		...(p.get(PARAM.tool) !== null && { tool: p.get(PARAM.tool) as string }),
		status: list[PARAM.status],
		search: p.get(PARAM.query) ?? "",
		jobsOnly: p.get(PARAM.jobs) === JOBS_ONLY,
		sort: { key: list[PARAM.sort], dir: list[PARAM.dir] },
		page: list[PARAM.page],
		perPage: list[PARAM.perPage],
		locate: p.get(PARAM.locate),
	};
}

const KINDS = Object.values(ATTEMPT_KIND);
const ATTEMPT_STATUSES = Object.values(ATTEMPT_STATUS);
const ORDERS = Object.values(ATTEMPT_ORDER);
const kindParam = z.enum(KINDS as [AttemptKind, ...AttemptKind[]]);
const targetsParams = z.object({
	[PARAM.kind]: kindParam.optional().catch(undefined),
	[PARAM.status]: z
		.enum(ATTEMPT_STATUSES as [string, ...string[]])
		.optional()
		.catch(undefined),
	[PARAM.sort]: z
		.enum(ORDERS as [string, ...string[]])
		.catch(ATTEMPT_ORDER.attempts),
	[PARAM.dir]: z.enum(SORT_DIRS).catch("desc"),
	[PARAM.page]: pageParam,
	[PARAM.perPage]: positiveIntParam.catch(DEFAULT_PAGE_SIZE),
});
const perPageOf = (value: number) => Math.min(value, PER_PAGE_MAX);

const usage = (message: string): HistoryResponse =>
	failure({ type: "InvalidInput", message });

function attemptTargetsOf(
	history: History,
	p: URLSearchParams,
): HistoryResponse {
	const q = targetsParams.parse(paramsOf(p));
	const perPage = perPageOf(q[PARAM.perPage]);
	const page = q[PARAM.page];
	const preset = presetParam.parse(param(p, PARAM.preset));
	const since = p.get(PARAM.since);
	return respond(
		history.attemptTargets({
			...(p.get(PARAM.query) !== null &&
				p.get(PARAM.query) !== "" && { target: p.get(PARAM.query) as string }),
			...(q[PARAM.kind] !== undefined && {
				kind: q[PARAM.kind] as AttemptKind,
			}),
			...(q[PARAM.status] !== undefined && {
				status: q[PARAM.status] as never,
			}),
			...(preset !== undefined && since === null && { preset }),
			...(since !== null && { since }),
			order: q[PARAM.sort] as never,
			dir: q[PARAM.dir],
			offset: (page - 1) * perPage,
			limit: perPage,
		}),
		(found) => ({ items: found.items, total: found.total, page, perPage }),
	);
}

function targetAttemptsOf(
	history: History,
	p: URLSearchParams,
): HistoryResponse {
	const kind = kindParam.safeParse(p.get(PARAM.kind));
	const target = p.get(PARAM.target);
	if (!kind.success || target === null || target === "") {
		return usage(
			"Indica `kind` (run_script, build_step o capture) y `target`.",
		);
	}
	const perPage = perPageOf(
		positiveIntParam.catch(DEFAULT_PAGE_SIZE).parse(param(p, PARAM.perPage)),
	);
	const wanted =
		p.get(PARAM.page) === null ? null : pageParam.parse(param(p, PARAM.page));
	const found = history.targetAttempts({
		kind: kind.data,
		target,
		offset: wanted === null ? null : (wanted - 1) * perPage,
		limit: perPage,
	});
	return success({
		items: found.items.map((a) => ({
			...a,
			change:
				a.changed === null
					? `intento ${a.n}: primero de este objetivo`
					: describeChange(a.n, a.changed, [
							...new Set(a.scripts.map((s) => s.role)),
						]),
		})),
		total: found.total,
		offset:
			wanted === null
				? Math.max(0, found.total - found.items.length)
				: (wanted - 1) * perPage,
		perPage,
	});
}

const attemptIdOf = (raw: string | undefined) => {
	const id = Number(raw);
	return Number.isSafeInteger(id) ? id : null;
};

function scriptOf(
	history: History,
	rawId: string | undefined,
	p: URLSearchParams,
	whole: boolean,
): HistoryResponse {
	const attemptId = attemptIdOf(rawId);
	const role = p.get(PARAM.role);
	if (role === null || role === "") return usage("Indica `role` (el papel).");
	const notFound = (): HistoryResponse =>
		failure({
			type: "NotFound",
			message: "Ese intento no tiene ese contenido.",
		});
	if (attemptId === null) return notFound();
	const looked = history.script({
		by: "attempt",
		attemptId,
		role: role as AttemptRole,
		path: p.get(PARAM.path) ?? undefined,
	});
	if (looked.kind === "not_found") return notFound();
	if (looked.kind === "needs_path") {
		return usage(
			`El papel «${role}» tiene varias rutas; indica \`path\`: ${looked.paths.map((x) => `«${x}»`).join(", ")}.`,
		);
	}
	const { script } = looked;
	if (whole) {
		return script.content === null
			? conflict(
					"Solo se guardó el hash de este contenido: pasó del tope de tamaño.",
				)
			: text(script.content);
	}
	const cut =
		script.content === null ? null : limitText(script.content, CONTENT_LINES);
	return success({
		sha256: script.sha256,
		kind: script.kind,
		bytes: script.bytes,
		stored: script.stored,
		lines: cut?.lines ?? 0,
		content: cut?.content ?? null,
		truncated: cut?.truncated ?? false,
	});
}

function attemptDiffOf(
	history: History,
	p: URLSearchParams,
	whole: boolean,
): HistoryResponse {
	const from = positiveIntParam.safeParse(p.get(PARAM.from));
	const to = positiveIntParam.safeParse(p.get(PARAM.to));
	if (!from.success || !to.success) {
		return usage("Indica `from` y `to`: los ids de dos intentos.");
	}
	const compared = makeAttemptDiff({ history, maxEdits: DIFF_MAX_EDITS })({
		from: from.data,
		to: to.data,
		role: p.get(PARAM.role) ?? undefined,
		path: p.get(PARAM.path) ?? undefined,
	});
	if (!compared.ok) return failure(compared.error);
	const result = compared.value;
	const diff = result.diff;
	if (whole) {
		if (diff === null) return text("");
		if (diff.kind === "too_big") {
			return conflict("Solo se guardó el hash de un lado: no hay diff.");
		}
		if (diff.kind === "too_large") {
			return conflict("Demasiados cambios para compararlos aquí.");
		}
		return text(
			`--- ${result.from.target} (intento ${result.from.n})\n+++ ${result.to.target} (intento ${result.to.n})\n${toUnifiedDiff(diff.hunks)}`,
		);
	}
	return success({
		from: result.from,
		to: result.to,
		roles: result.roles,
		assets: result.assets,
		diff:
			diff === null || diff.kind !== "diff"
				? diff
				: {
						role: diff.role,
						path: diff.path,
						kind: diff.kind,
						added: diff.added,
						removed: diff.removed,
						...(() => {
							const cut = limitHunks(diff.hunks, DIFF_LINES);
							return { hunks: cut.hunks, truncated: cut.truncated };
						})(),
					},
	});
}

// GET /api/history/*. Devuelve null si la ruta no es del histórico (otro manejador la atiende)
export function handleHistoryRequest(
	history: History,
	pathname: string,
	p: URLSearchParams,
): HistoryResponse | null {
	if (!pathname.startsWith(HISTORY_ROUTE.prefix)) return null;
	const name = pathname.slice(HISTORY_ROUTE.prefix.length);
	const limit = limitParam.parse(param(p, PARAM.limit));

	switch (name) {
		case HISTORY_ROUTE.summary:
			return respond(history.summarize(rangeOf(p)), (summary) => ({ summary }));
		case HISTORY_ROUTE.errors:
			return respond(history.errors(rangeOf(p), limit), asPage);
		case HISTORY_ROUTE.nodes:
			return respond(history.nodesTouched(rangeOf(p), limit), asPage);
		case HISTORY_ROUTE.sessions:
			return respond(history.sessions(rangeOf(p), limit), asPage);
		case HISTORY_ROUTE.search:
			return respond(
				history.search({
					query: p.get(PARAM.query) ?? "",
					range: rangeOf(p),
					...(limit !== undefined && { limit }),
				}),
				asPage,
			);
		case HISTORY_ROUTE.calls:
			return respond(history.list(listOf(p)), (page) => ({
				...asPage(page),
				page: page.page,
				perPage: page.perPage,
			}));
		case HISTORY_ROUTE.captures: {
			const page = history.captures(
				pageParam.parse(param(p, PARAM.page)),
				perPageParam.parse(param(p, PARAM.perPage)),
			);
			return success({
				...asPage(page),
				page: page.page,
				perPage: page.perPage,
			});
		}
		case HISTORY_ROUTE.status:
			return success({ status: history.status() });
		case HISTORY_ROUTE.attemptTargets:
			return attemptTargetsOf(history, p);
		case HISTORY_ROUTE.attempts:
			return targetAttemptsOf(history, p);
		case HISTORY_ROUTE.attemptDiff:
			return attemptDiffOf(history, p, false);
		case HISTORY_ROUTE.attemptDiffRaw:
			return attemptDiffOf(history, p, true);
	}
	const rawScript = HISTORY_ROUTE.attemptScriptRaw.exec(name);
	if (rawScript !== null) return scriptOf(history, rawScript[1], p, true);
	const oneScript = HISTORY_ROUTE.attemptScript.exec(name);
	if (oneScript !== null) return scriptOf(history, oneScript[1], p, false);
	if (name.startsWith(HISTORY_ROUTE.callsPrefix)) {
		const id = decodeURIComponent(name.slice(HISTORY_ROUTE.callsPrefix.length));
		return respond(history.call(id), (call) => ({ call }));
	}
	const oneStep = HISTORY_ROUTE.stepResult.exec(name);
	if (oneStep !== null) {
		const [, rawId = "", index = ""] = oneStep;
		return respond(
			history.stepResult(decodeURIComponent(rawId), Number(index)),
			(stepResult) => ({ stepResult }),
		);
	}
	if (
		name.startsWith(HISTORY_ROUTE.jobsPrefix) &&
		name.endsWith(HISTORY_ROUTE.stepsSuffix)
	) {
		const id = decodeURIComponent(
			name.slice(
				HISTORY_ROUTE.jobsPrefix.length,
				-HISTORY_ROUTE.stepsSuffix.length,
			),
		);
		// Un id vacío (`jobs//steps`, `jobs/steps`) es 404, como una llamada inexistente: no un 200 con lista vacía.
		if (id !== "") return success({ steps: history.steps(id) });
	}
	return {
		status: STATUS.notFound,
		body: {
			ok: false,
			error: { type: "NotFound", message: `No existe ${pathname}` },
		},
	};
}
