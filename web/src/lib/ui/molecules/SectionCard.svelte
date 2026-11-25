<script lang="ts">
import type { Snippet } from "svelte";

type Padding = "none" | "sm" | "md" | "lg";
type Props = {
	padding?: Padding;
	title?: Snippet;
	actions?: Snippet;
	footer?: Snippet;
	children: Snippet;
};

let { padding = "md", title, actions, footer, children }: Props = $props();

const PADDING: Record<Padding, string> = {
	none: "",
	sm: "px-5 py-3",
	md: "px-5 py-4",
	lg: "px-6 py-6",
};
</script>

<section class="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
	{#if title || actions}
		<header class="flex items-center justify-between gap-4 px-5 pt-5 pb-3">
			<h2 class="truncate text-eyebrow text-text-muted uppercase">{@render title?.()}</h2>
			{#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class={PADDING[padding]}>{@render children()}</div>
	{#if footer}
		<footer class="flex items-center justify-end gap-3 border-t border-border bg-surface-raised px-5 py-3">{@render footer()}</footer>
	{/if}
</section>
