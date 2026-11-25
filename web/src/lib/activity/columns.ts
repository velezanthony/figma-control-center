import { SORT_KEY } from "#web/lib/activity/sort.ts";
import { COLUMN_TERM } from "#web/lib/glossary/terms.ts";
import type { Column } from "#web/lib/ui/table.ts";

export const ACTIVITY_COLUMNS: readonly Column[] = [
	{
		id: "time",
		label: "Hora",
		sortKey: SORT_KEY.time,
		shrink: true,
		term: COLUMN_TERM.time,
	},
	{
		id: "tool",
		label: "Herramienta",
		sortKey: SORT_KEY.tool,
		term: COLUMN_TERM.tool,
	},
	{
		id: "status",
		label: "Resultado",
		sortKey: SORT_KEY.status,
		term: COLUMN_TERM.status,
	},
	{
		id: "duration",
		label: "Duración",
		sortKey: SORT_KEY.duration,
		align: "right",
		term: COLUMN_TERM.duration,
	},
	{
		id: "nodes",
		label: "Nodos",
		sortKey: SORT_KEY.nodes,
		align: "right",
		term: COLUMN_TERM.nodes,
	},
	{
		id: "session",
		label: "Sesión",
		sortKey: SORT_KEY.session,
		term: COLUMN_TERM.session,
	},
];

export const JOBS_COLUMNS: readonly Column[] = [
	{ id: "time", label: "Lanzado", shrink: true, term: COLUMN_TERM.time },
	{ id: "tool", label: "Script", term: COLUMN_TERM.tool },
	{ id: "job", label: "Job", term: COLUMN_TERM.job },
	{ id: "status", label: "Estado", term: COLUMN_TERM.status },
	{
		id: "duration",
		label: "Duración",
		align: "right",
		term: COLUMN_TERM.duration,
	},
	{ id: "nodes", label: "Nodos", align: "right", term: COLUMN_TERM.nodes },
];
