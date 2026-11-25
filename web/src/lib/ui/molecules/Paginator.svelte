<script lang="ts">
import Icon from "#web/lib/ui/icons/Icon.svelte";
import { GAP, pageItems } from "#web/lib/ui/page-items.ts";

type Props = { page: number; pageCount: number; onpage: (page: number) => void };
let { page, pageCount, onpage }: Props = $props();

const items = $derived(pageItems(page, pageCount));
const BOX = "inline-flex size-9 items-center justify-center rounded-md text-sm font-medium transition duration-base";
const EDGE = "border border-border bg-surface text-text-secondary hover:bg-surface-raised hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface";
</script>

{#if pageCount > 1}
	<nav aria-label="Paginación" class="flex items-center gap-1.5">
		<button type="button" class="{BOX} {EDGE}" aria-label="Página anterior" disabled={page <= 1} onclick={() => onpage(page - 1)}>
			<Icon name="chevron-left" weight="bold" />
		</button>
		{#each items as item, i (item === GAP ? `gap-${i}` : item)}
			{#if item === GAP}
				<span aria-hidden="true" class="px-1 text-sm text-text-muted">…</span>
			{:else if item === page}
				<span aria-current="page" class="{BOX} bg-brand-500 font-semibold text-on-brand">{item}</span>
			{:else}
				<button type="button" class="{BOX} {EDGE}" aria-label="Página {item}" onclick={() => onpage(item)}>{item}</button>
			{/if}
		{/each}
		<button type="button" class="{BOX} {EDGE}" aria-label="Página siguiente" disabled={page >= pageCount} onclick={() => onpage(page + 1)}>
			<Icon name="chevron-right" weight="bold" />
		</button>
	</nav>
{/if}
