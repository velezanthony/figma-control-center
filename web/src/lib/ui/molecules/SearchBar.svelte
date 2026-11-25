<script lang="ts">
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Input from "#web/lib/ui/atoms/Input.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

type Props = { value?: string; placeholder?: string; label: string };

let { value = $bindable(""), placeholder = "Buscar", label }: Props = $props();
</script>

<Input type="search" name="buscar" bind:value {placeholder} aria-label={label} autocomplete="off">
	{#snippet icon()}<Icon name="magnifying-glass" />{/snippet}
	{#snippet trailing()}
		{#if value !== ""}
			<Button variant={BUTTON_VARIANT.ghost} shape="icon" size="sm" aria-label="Borrar la búsqueda" onclick={() => (value = "")}>
				<Icon name="x-mark" />
			</Button>
		{/if}
	{/snippet}
</Input>
