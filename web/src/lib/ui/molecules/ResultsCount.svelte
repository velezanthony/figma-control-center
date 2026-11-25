<script lang="ts">
type Props = { from: number; to: number; total: number };
let { from, to, total }: Props = $props();
</script>

<p class="text-xs text-text-muted">
	{#if total === 0}
		Sin resultados
	{:else}
		Mostrando <span class="font-medium text-text-secondary tabular-nums">{from}-{to}</span> de
		<span class="font-medium text-text-secondary tabular-nums">{total}</span>
		{total === 1 ? "resultado" : "resultados"}
	{/if}
</p>
