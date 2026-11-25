export const STATUS_FILTER = Object.freeze({
	all: "all",
	ok: "ok",
	error: "error",
	running: "running",
} as const);
export type StatusFilter = (typeof STATUS_FILTER)[keyof typeof STATUS_FILTER];

export const isStatusFilter = (value: unknown): value is StatusFilter =>
	Object.values(STATUS_FILTER).includes(value as StatusFilter);

// Qué se pide a la base: los filtros se aplican en el servidor (GET /api/history/calls)
export type Filters = {
	readonly query: string;
	readonly tool: string | null;
	readonly status: StatusFilter;
	readonly sessionId: string | null;
};

export const DEFAULT_FILTERS: Filters = {
	query: "",
	tool: null,
	status: STATUS_FILTER.all,
	sessionId: null,
};

export const hasActiveFilters = (filters: Filters): boolean =>
	filters.query.trim() !== "" ||
	filters.tool !== null ||
	filters.sessionId !== null ||
	filters.status !== STATUS_FILTER.all;
