<script lang="ts">
import { termOf } from "#web/lib/glossary/terms.ts";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";
import type { SortDir } from "#web/lib/activity/sort.ts";
import type { Snippet } from "svelte";

type Align = "left" | "right";
// sort: undefined = columna no ordenable; "none" = ordenable sin orden activo
// term: clave del glosario que explica la cabecera; en una columna ordenable el propio botón es el disparador
type Props = { align?: Align; shrink?: boolean; sort?: SortDir | "none" | undefined; onsort?: (() => void) | undefined; term?: string | undefined; children: Snippet };

let { align = "left", shrink = false, sort, onsort, term, children }: Props = $props();

const definition = $derived(term === undefined ? null : termOf(term));

const ARIA = { asc: "ascending", desc: "descending", none: "none" } as const;
const ICON = { asc: "chevron-up", desc: "chevron-down", none: "chevron-up-down" } as const;
</script>

<th
	scope="col"
	aria-sort={sort === undefined ? undefined : ARIA[sort]}
	class="px-4 py-2.5 font-semibold {align === 'right' ? 'text-right' : 'text-left'} {shrink ? 'w-px whitespace-nowrap' : ''}"
>
	{#if sort !== undefined}
		{#snippet sorter(trigger: { "aria-describedby"?: string })}
			<button
				type="button"
				onclick={onsort}
				class="group inline-flex cursor-pointer items-center gap-1.5 uppercase transition-colors hover:text-text-primary {sort === 'none' ? '' : 'text-text-primary'}"
				{...trigger}
			>
				{@render children()}
				<span class={sort === "none" ? "opacity-40 group-hover:opacity-100" : "text-brand-600"}><Icon name={ICON[sort]} size="xs" weight="bold" /></span>
			</button>
		{/snippet}
		{#if definition}
			<Tooltip placement="bottom">
				{#snippet children(trigger)}{@render sorter(trigger)}{/snippet}
				{#snippet content()}<span class="font-semibold normal-case">{definition.label}.</span> <span class="normal-case">{definition.short}</span>{/snippet}
			</Tooltip>
		{:else}
			{@render sorter({})}
		{/if}
	{:else if term}
		<Term {term} variant={TERM_VARIANT.bare}>{@render children()}</Term>
	{:else}
		{@render children()}
	{/if}
</th>
