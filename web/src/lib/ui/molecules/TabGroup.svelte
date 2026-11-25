<script lang="ts">
import Tab from "#web/lib/ui/atoms/Tab.svelte";
import { TAB_VARIANT, type TabVariant } from "#web/lib/ui/atoms/Tab.svelte";
import { nextIndex } from "#web/lib/ui/roving.ts";

export type TabItem = { readonly id: string; readonly label: string; readonly count?: number };
// TabGroup reenvía el mismo prop a Tab: comparte su unión (fuente única en Tab.svelte).
type Props = { label: string; tabs: readonly TabItem[]; selected: string; variant?: TabVariant; onselect: (id: string) => void };

let { label, tabs, selected, variant = TAB_VARIANT.underline, onselect }: Props = $props();

let list: HTMLDivElement | undefined = $state();

function onkeydown(event: KeyboardEvent) {
	const current = tabs.findIndex((t) => t.id === selected);
	const target = nextIndex(event.key, current, tabs.length, "horizontal");
	const tab = target === null ? undefined : tabs[target];
	if (tab === undefined) return;
	event.preventDefault();
	onselect(tab.id);
	list?.querySelectorAll<HTMLElement>('[role="tab"]')[target as number]?.focus();
}

const GROUP = {
	underline: "flex w-full items-start gap-0.5 px-1 overflow-x-auto overflow-y-hidden inset-shadow-[0_-1px_0_0] inset-shadow-border",
	segmented: "inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised p-0.75",
} as const;
</script>

<div bind:this={list} role="tablist" aria-label={label} tabindex="-1" {onkeydown} class={GROUP[variant]}>
	{#each tabs as tab (tab.id)}
		<Tab {variant} selected={tab.id === selected} count={tab.count} onclick={() => onselect(tab.id)}>{tab.label}</Tab>
	{/each}
</div>
