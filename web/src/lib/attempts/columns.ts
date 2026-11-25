import type { AttemptOrder } from "#web/lib/contract.ts";
import { ATTEMPT_TERM } from "#web/lib/glossary/terms.ts";
import type { Column } from "#web/lib/ui/table.ts";

// Las columnas de la lista de objetivos; ordenar por intentos o por el último lo hace el servidor
export const ATTEMPT_COLUMNS: readonly Column<AttemptOrder>[] = [
	{ id: "target", label: "Objetivo" },
	{ id: "kind", label: "Tipo" },
	{ id: "attempts", label: "Intentos", sortKey: "attempts", align: "right" },
	{ id: "status", label: "Último estado", term: ATTEMPT_TERM.lastStatus },
	{ id: "last", label: "Último", sortKey: "last", align: "right" },
];
