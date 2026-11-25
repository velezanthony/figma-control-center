import {
	DEFAULT_PER_PAGE,
	PER_PAGE_CHOICES,
} from "#web/lib/activity/paginate.ts";
import type {
	AttemptKind,
	AttemptOrder,
	AttemptStatus,
} from "#web/lib/contract.ts";

// Lo que la página «Intentos» guarda en la URL (hash): la lista (filtros, orden, página) y, si hay uno abierto, el
// detalle de un objetivo con el par de intentos comparado. Recargar conserva la vista
export const KINDS = [
	"run_script",
	"build_step",
	"capture",
] as const satisfies readonly AttemptKind[];
export const STATUSES = [
	"ok",
	"contract_error",
	"error",
] as const satisfies readonly AttemptStatus[];
export const PRESETS = ["today", "last_hour"] as const;
export type AttemptPreset = (typeof PRESETS)[number];
export const SORT_KEYS = [
	"attempts",
	"last",
] as const satisfies readonly AttemptOrder[];
export type SortDir = "asc" | "desc";

export type AttemptFilters = {
	readonly kind: AttemptKind | null;
	readonly status: AttemptStatus | null;
	readonly query: string;
	readonly preset: AttemptPreset | null;
	// Una fecha concreta (AAAA-MM-DD o ISO 8601); manda sobre el preset
	readonly since: string | null;
};

export type AttemptSort = { readonly key: AttemptOrder; readonly dir: SortDir };

// El objetivo abierto: tipo y objetivo exactos, los ids del par comparado y, si se mira uno, su papel (y ruta)
export type DetailRef = {
	readonly kind: AttemptKind;
	readonly target: string;
	readonly a: number | null;
	readonly b: number | null;
	readonly role: string | null;
	readonly path: string | null;
};

export type AttemptsView = {
	readonly filters: AttemptFilters;
	readonly sort: AttemptSort;
	readonly page: number;
	readonly perPage: number;
	readonly detail: DetailRef | null;
};

export const DEFAULT_ATTEMPT_FILTERS: AttemptFilters = {
	kind: null,
	status: null,
	query: "",
	preset: null,
	since: null,
};

export const DEFAULT_ATTEMPT_SORT: AttemptSort = {
	key: "attempts",
	dir: "desc",
};

export const DEFAULT_ATTEMPTS_VIEW: AttemptsView = {
	filters: DEFAULT_ATTEMPT_FILTERS,
	sort: DEFAULT_ATTEMPT_SORT,
	page: 1,
	perPage: DEFAULT_PER_PAGE,
	detail: null,
};

const PARAM = Object.freeze({
	kind: "kind",
	status: "status",
	query: "q",
	preset: "preset",
	since: "since",
	sort: "sort",
	dir: "dir",
	page: "page",
	perPage: "per",
	target: "t",
	detailKind: "k",
	a: "a",
	b: "b",
	role: "role",
	path: "path",
} as const);

const oneOf = <T extends string>(
	list: readonly T[],
	value: string | null,
): T | null => list.find((item) => item === value) ?? null;

const positiveInt = (raw: string | null): number | null => {
	const n = Number(raw);
	return raw !== null && Number.isInteger(n) && n >= 1 ? n : null;
};

const nonEmpty = (raw: string | null): string | null =>
	raw === null || raw === "" ? null : raw;

export function hasActiveAttemptFilters(filters: AttemptFilters): boolean {
	return (
		filters.kind !== null ||
		filters.status !== null ||
		filters.query.trim() !== "" ||
		filters.preset !== null ||
		filters.since !== null
	);
}

export function parseAttemptsView(search: string): AttemptsView {
	const p = new URLSearchParams(search);
	const since = nonEmpty(p.get(PARAM.since));
	const perPage = positiveInt(p.get(PARAM.perPage)) ?? DEFAULT_PER_PAGE;
	const sortKey = oneOf(SORT_KEYS, p.get(PARAM.sort));
	const kind = oneOf(KINDS, p.get(PARAM.detailKind));
	const target = nonEmpty(p.get(PARAM.target));
	return {
		filters: {
			kind: oneOf(KINDS, p.get(PARAM.kind)),
			status: oneOf(STATUSES, p.get(PARAM.status)),
			query: p.get(PARAM.query) ?? "",
			preset: since === null ? oneOf(PRESETS, p.get(PARAM.preset)) : null,
			since,
		},
		sort:
			sortKey === null
				? DEFAULT_ATTEMPT_SORT
				: { key: sortKey, dir: p.get(PARAM.dir) === "asc" ? "asc" : "desc" },
		page: positiveInt(p.get(PARAM.page)) ?? 1,
		perPage: (PER_PAGE_CHOICES as readonly number[]).includes(perPage)
			? perPage
			: DEFAULT_PER_PAGE,
		detail:
			kind === null || target === null
				? null
				: {
						kind,
						target,
						a: positiveInt(p.get(PARAM.a)),
						b: positiveInt(p.get(PARAM.b)),
						role: nonEmpty(p.get(PARAM.role)),
						path: nonEmpty(p.get(PARAM.path)),
					},
	};
}

// Solo escribe lo que difiere del defecto
export function serializeAttemptsView(view: AttemptsView): string {
	const p = new URLSearchParams();
	const { filters, sort, detail } = view;
	if (filters.kind !== null) p.set(PARAM.kind, filters.kind);
	if (filters.status !== null) p.set(PARAM.status, filters.status);
	if (filters.query !== "") p.set(PARAM.query, filters.query);
	if (filters.since !== null) p.set(PARAM.since, filters.since);
	else if (filters.preset !== null) p.set(PARAM.preset, filters.preset);
	if (
		sort.key !== DEFAULT_ATTEMPT_SORT.key ||
		sort.dir !== DEFAULT_ATTEMPT_SORT.dir
	) {
		p.set(PARAM.sort, sort.key);
		p.set(PARAM.dir, sort.dir);
	}
	if (view.page !== 1) p.set(PARAM.page, String(view.page));
	if (view.perPage !== DEFAULT_PER_PAGE)
		p.set(PARAM.perPage, String(view.perPage));
	if (detail !== null) {
		p.set(PARAM.target, detail.target);
		p.set(PARAM.detailKind, detail.kind);
		if (detail.a !== null) p.set(PARAM.a, String(detail.a));
		if (detail.b !== null) p.set(PARAM.b, String(detail.b));
		if (detail.role !== null) p.set(PARAM.role, detail.role);
		if (detail.path !== null) p.set(PARAM.path, detail.path);
	}
	return p.toString();
}

export const openTarget = (
	view: AttemptsView,
	kind: AttemptKind,
	target: string,
): AttemptsView => ({
	...view,
	detail: { kind, target, a: null, b: null, role: null, path: null },
});

export const closeDetail = (view: AttemptsView): AttemptsView => ({
	...view,
	detail: null,
});
