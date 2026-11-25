import {
	DEFAULT_FILTERS,
	type Filters,
	isStatusFilter,
	STATUS_FILTER,
} from "./filters.ts";
import { DEFAULT_PER_PAGE, PER_PAGE_CHOICES } from "./paginate.ts";
import { DEFAULT_SORT, isSortKey, type SortState } from "./sort.ts";

// Estado de la pantalla de actividad que vive en la URL (hash): recargar conserva la vista
export type View = {
	readonly filters: Filters;
	readonly sort: SortState;
	readonly page: number;
	readonly perPage: number;
	readonly open: string | null;
};

export const DEFAULT_VIEW: View = {
	filters: DEFAULT_FILTERS,
	sort: DEFAULT_SORT,
	page: 1,
	perPage: DEFAULT_PER_PAGE,
	open: null,
};

const PARAM = Object.freeze({
	query: "q",
	tool: "tool",
	status: "status",
	session: "session",
	sort: "sort",
	dir: "dir",
	page: "page",
	perPage: "per",
	open: "open",
} as const);

const asPositiveInt = (raw: string | null, fallback: number): number => {
	const n = Number(raw);
	return Number.isInteger(n) && n >= 1 ? n : fallback;
};

export function parseView(search: string): View {
	const p = new URLSearchParams(search);
	const status = p.get(PARAM.status);
	const sortKey = p.get(PARAM.sort);
	const dir = p.get(PARAM.dir);
	const perPage = asPositiveInt(p.get(PARAM.perPage), DEFAULT_PER_PAGE);
	return {
		filters: {
			query: p.get(PARAM.query) ?? "",
			tool: p.get(PARAM.tool),
			status: isStatusFilter(status) ? status : STATUS_FILTER.all,
			sessionId: p.get(PARAM.session),
		},
		sort: isSortKey(sortKey)
			? { key: sortKey, dir: dir === "asc" ? "asc" : "desc" }
			: DEFAULT_SORT,
		page: asPositiveInt(p.get(PARAM.page), 1),
		perPage: (PER_PAGE_CHOICES as readonly number[]).includes(perPage)
			? perPage
			: DEFAULT_PER_PAGE,
		open: p.get(PARAM.open),
	};
}

// Solo escribe lo que difiere del defecto
export function serializeView(view: View): string {
	const p = new URLSearchParams();
	const { filters, sort } = view;
	if (filters.query !== "") p.set(PARAM.query, filters.query);
	if (filters.tool !== null) p.set(PARAM.tool, filters.tool);
	if (filters.status !== STATUS_FILTER.all) p.set(PARAM.status, filters.status);
	if (filters.sessionId !== null) p.set(PARAM.session, filters.sessionId);
	if (sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir) {
		p.set(PARAM.sort, sort.key);
		p.set(PARAM.dir, sort.dir);
	}
	if (view.page !== 1) p.set(PARAM.page, String(view.page));
	if (view.perPage !== DEFAULT_PER_PAGE)
		p.set(PARAM.perPage, String(view.perPage));
	if (view.open !== null) p.set(PARAM.open, view.open);
	return p.toString();
}
