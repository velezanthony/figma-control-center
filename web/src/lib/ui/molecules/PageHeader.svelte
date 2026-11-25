<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	title: Snippet;
	description?: Snippet;
	meta?: Snippet;
	actions?: Snippet;
};

let { title, description, meta, actions }: Props = $props();
</script>

<header class="mb-8 flex flex-wrap items-end justify-between gap-4">
	<div class="min-w-0">
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-display text-text-primary">{@render title()}</h1>
			{@render meta?.()}
		</div>
		{#if description}<p class="mt-2 max-w-2xl text-base/relaxed text-text-muted">{@render description()}</p>{/if}
	</div>
	{#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
</header>
