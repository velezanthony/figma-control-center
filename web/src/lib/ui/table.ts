import type { SortKey } from "#web/lib/activity/sort.ts";

// K: las claves por las que se puede ordenar (las de Actividad por defecto)
export type Column<K extends string = SortKey> = {
	readonly id: string;
	readonly label: string;
	readonly sortKey?: K;
	readonly align?: "left" | "right";
	readonly shrink?: boolean;
	// Clave del glosario que explica la cabecera (tooltip)
	readonly term?: string;
};
