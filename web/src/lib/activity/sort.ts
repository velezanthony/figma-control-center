export const SORT_KEY = Object.freeze({
	time: "time",
	tool: "tool",
	status: "status",
	duration: "duration",
	nodes: "nodes",
	session: "session",
} as const);
export type SortKey = (typeof SORT_KEY)[keyof typeof SORT_KEY];
export type SortDir = "asc" | "desc";
export type SortState = { readonly key: SortKey; readonly dir: SortDir };

// La ordenación la hace el servidor: aquí solo vive el estado de la columna activa
export const DEFAULT_SORT: SortState = { key: SORT_KEY.time, dir: "desc" };

export const isSortKey = (value: unknown): value is SortKey =>
	Object.values(SORT_KEY).includes(value as SortKey);

export const toggleSort = (current: SortState, key: SortKey): SortState =>
	current.key === key
		? { key, dir: current.dir === "asc" ? "desc" : "asc" }
		: { key, dir: "asc" };
