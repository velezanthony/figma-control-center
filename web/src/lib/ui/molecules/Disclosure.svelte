<script lang="ts">
import type { Snippet } from "svelte";
import { slide } from "svelte/transition";
import Icon from "#web/lib/ui/icons/Icon.svelte";

type Props = {
	open?: boolean;
	title: Snippet;
	subtitle?: Snippet;
	icon?: Snippet;
	actions?: Snippet;
	children: Snippet;
};

let { open = $bindable(false), title, subtitle, icon, actions, children }: Props = $props();

const id = $props.id();
</script>

<section class="rounded-xl border border-border bg-surface shadow-xs">
	<div class="flex items-center gap-3 px-6 py-4">
		<button
			type="button"
			aria-expanded={open}
			aria-controls="{id}-body"
			onclick={() => (open = !open)}
			class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-left"
		>
			{#if icon}<span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">{@render icon()}</span>{/if}
			<span class="min-w-0 flex-1">
				<span class="block truncate text-base font-semibold text-text-primary">{@render title()}</span>
				{#if subtitle}<span class="block text-xs text-text-secondary">{@render subtitle()}</span>{/if}
			</span>
			<span class="text-text-muted transition-transform duration-base {open ? 'rotate-180' : ''}"><Icon name="chevron-down" /></span>
		</button>
		{#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
	</div>
	{#if open}
		<div id="{id}-body" transition:slide={{ duration: 150 }} class="border-t border-border p-6">{@render children()}</div>
	{/if}
</section>
