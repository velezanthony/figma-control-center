<script lang="ts">
	type Props = { items: readonly (readonly [string, string | number | boolean | null])[] };
	let { items }: Props = $props();
</script>

{#if items.length === 0}
	<p class="text-sm text-text-secondary">Sin argumentos.</p>
{:else}
	<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
		{#each items as [key, value] (key)}
			<dt class="font-mono text-xs text-text-muted">{key}</dt>
			<dd class="font-mono text-xs break-all text-text-primary">{String(value)}</dd>
		{/each}
	</dl>
{/if}
