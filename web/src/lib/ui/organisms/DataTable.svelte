<script lang="ts" generics="T, K extends string = SortKey">
import type { Snippet } from "svelte";
import type { SortDir, SortKey } from "#web/lib/activity/sort.ts";
import type { Column } from "#web/lib/ui/table.ts";
import Th from "./Th.svelte";
import Tr from "./Tr.svelte";


type Props = {
	// Nombre accesible de la tabla
	label: string;
	columns: readonly Column<K>[];
	rows: readonly T[];
	rowId: (row: T) => string;
	sort?: { readonly key: K; readonly dir: SortDir };
	onsort?: (key: K) => void;
	expandedId?: string | null;
	ontoggle?: (id: string) => void;
	// Clic en la fila (o en su botón, para el teclado) abre otra vista: la fila no se despliega
	onopen?: (id: string) => void;
	highlighted?: ReadonlySet<string>;
	// Las <Td> de cada fila
	cells: Snippet<[T]>;
	// Contenido de la fila desplegada; si falta, las filas no se despliegan
	detail?: Snippet<[T]>;
	empty: Snippet;
};

let { label, columns, rows, rowId, sort, onsort, expandedId = null, ontoggle, onopen, highlighted, cells, detail, empty }: Props = $props();

const sortOf = (c: Column<K>) =>
	c.sortKey === undefined ? undefined : sort?.key === c.sortKey ? sort.dir : "none";
const span = $derived(columns.length + (detail ? 1 : 0));
</script>

<div class="overflow-x-auto rounded-xl border border-border bg-surface contain-paint max-md:overflow-visible max-md:border-0 max-md:bg-transparent">
	<table aria-label={label} class="w-full text-sm max-md:block">
		<thead class="bg-surface-raised text-[11px] font-semibold tracking-wider text-text-secondary uppercase max-md:hidden">
			<tr>
				{#each columns as column (column.id)}
					<Th
						align={column.align ?? "left"}
						shrink={column.shrink ?? false}
						sort={sortOf(column)}
						term={column.term}
						onsort={column.sortKey === undefined ? undefined : () => onsort?.(column.sortKey as K)}
					>{column.label}</Th>
				{/each}
				{#if detail}<th scope="col" class="w-px px-4 py-2.5"><span class="sr-only">Detalle</span></th>{/if}
			</tr>
		</thead>
		<tbody class="divide-y divide-border/60 text-text-primary max-md:block max-md:space-y-3 max-md:divide-y-0">
			{#each rows as row (rowId(row))}
				{@const id = rowId(row)}
				<Tr
					id="row-{id}"
					expandable={detail !== undefined}
					expanded={expandedId === id}
					highlight={highlighted?.has(id) ?? false}
					ontoggle={() => ontoggle?.(id)}
					onopen={onopen === undefined ? undefined : () => onopen(id)}
				>
					{@render cells(row)}
				</Tr>
				{#if detail && expandedId === id}
					<tr id="row-{id}-detail" class="max-md:block">
						<td colspan={span} class="bg-surface-raised px-6 py-5 max-md:block max-md:rounded-xl max-md:border max-md:border-border">
							{@render detail(row)}
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
	{#if rows.length === 0}{@render empty()}{/if}
</div>
