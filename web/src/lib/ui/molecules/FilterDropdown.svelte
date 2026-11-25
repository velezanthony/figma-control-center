<script lang="ts">
import { tick } from "svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import { float } from "#web/lib/ui/float.ts";
import { nextIndex } from "#web/lib/ui/roving.ts";

export type FilterOption = { readonly value: string; readonly label: string };
// Valor vacío = sin filtro (todas las opciones)
type Props = {
	label: string;
	options: readonly FilterOption[];
	value: string;
	allLabel?: string;
	onchange: (value: string) => void;
};

let { label, options, value, allLabel = "Todas", onchange }: Props = $props();

const ALL = "";
const MENU_GAP = 6;
const id = $props.id();

let open = $state(false);
let root: HTMLDivElement | undefined = $state();
let trigger: HTMLButtonElement | undefined = $state();
let items: HTMLButtonElement[] = $state([]);

const all = $derived<readonly FilterOption[]>([{ value: ALL, label: allLabel }, ...options]);
const selected = $derived(all.find((o) => o.value === value));
const active = $derived(value !== ALL);

async function openAt(index: number) {
	open = true;
	await tick();
	items[index]?.focus();
}

function close(refocus: boolean) {
	open = false;
	if (refocus) trigger?.focus();
}

function pick(next: string) {
	onchange(next);
	close(true);
}

function onTriggerKey(event: KeyboardEvent) {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		const at = Math.max(0, all.findIndex((o) => o.value === value));
		void openAt(at);
	}
}

function onMenuKey(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		close(true);
		return;
	}
	if (event.key === "Tab") {
		close(false);
		return;
	}
	const current = items.findIndex((el) => el === document.activeElement);
	const target = nextIndex(event.key, current, all.length, "vertical");
	if (target !== null) {
		event.preventDefault();
		items[target]?.focus();
	}
}

function onWindowPointer(event: MouseEvent) {
	if (open && root && !root.contains(event.target as Node)) close(false);
}
</script>

<svelte:window onclick={onWindowPointer} />

<div class="relative" bind:this={root}>
	<button
		bind:this={trigger}
		type="button"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="{id}-menu"
		onclick={() => (open ? close(false) : void openAt(Math.max(0, all.findIndex((o) => o.value === value))))}
		onkeydown={onTriggerKey}
		class="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium text-text-secondary shadow-xs transition duration-base hover:border-border-strong/40 hover:bg-surface-raised hover:shadow-sm motion-safe:hover:-translate-y-px {active ? 'border-brand-300 bg-brand-50/30' : 'border-border bg-surface'}"
	>
		<span><span class="text-text-muted">{label}:</span> <span class="text-text-primary">{active ? selected?.label : allLabel.toLowerCase()}</span></span>
		<span class="transition-transform duration-base {open ? 'rotate-180' : ''}"><Icon name="chevron-down" /></span>
	</button>
	{#if open}
		<div
			id="{id}-menu"
			role="menu"
			aria-label={label}
			tabindex="-1"
			popover="manual"
			use:float={{ anchor: trigger, placement: "bottom-start", gap: MENU_GAP }}
			onkeydown={onMenuKey}
			class="m-0 max-h-72 min-w-[200px] overflow-y-auto rounded-md border border-border bg-surface p-1 text-text-primary shadow-xl"
		>
			{#each all as option, i (option.value)}
				<button
					bind:this={items[i]}
					type="button"
					role="menuitemradio"
					aria-checked={option.value === value}
					tabindex="-1"
					onclick={() => pick(option.value)}
					class="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.75 text-left text-sm font-medium transition-colors hover:bg-surface-sunken {option.value === value ? 'text-brand-700' : 'text-text-secondary hover:text-text-primary'}"
				>
					<span class="flex-1 truncate">{option.label}</span>
					{#if option.value === value}<Icon name="check" />{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
