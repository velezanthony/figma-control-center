<script lang="ts">
	import type { Snippet } from "svelte";

	type Props = { title: Snippet; children: Snippet };
	let { title, children }: Props = $props();
</script>

<section class="flex flex-col gap-2">
	<h3 class="text-eyebrow text-text-muted uppercase">{@render title()}</h3>
	{@render children()}
</section>
