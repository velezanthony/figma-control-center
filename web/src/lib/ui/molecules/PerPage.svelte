<script lang="ts">
import Select from "#web/lib/ui/atoms/Select.svelte";

type Props = { value: number; choices: readonly number[]; onchange: (value: number) => void };
let { value, choices, onchange }: Props = $props();
</script>

<div class="flex items-center gap-2 text-sm text-text-secondary">
	<span id="per-page-label">Mostrar</span>
	<div class="w-20">
		<Select
			size="sm"
			name="por-pagina"
			aria-labelledby="per-page-label"
			value={String(value)}
			onchange={(e) => onchange(Number(e.currentTarget.value))}
		>
			{#each choices as choice (choice)}<option value={String(choice)}>{choice}</option>{/each}
		</Select>
	</div>
</div>
