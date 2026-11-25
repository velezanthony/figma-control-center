<script lang="ts">
import type { Snippet } from "svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import Modal from "#web/lib/ui/molecules/Modal.svelte";

// «Cerrar agente»: desactivado, el motivo sale en el tooltip; con `confirm`, pregunta antes
// en un modal. Solo avisa con `onclose`: quien lo usa pide al panel que cierre (el panel nunca mata procesos)
type Props = {
	disabled?: boolean;
	confirm?: boolean;
	loading?: boolean;
	onclose: () => void;
	// Por qué no se puede cerrar (tooltip del botón desactivado)
	reason?: Snippet;
	// La pregunta de la confirmación
	question?: Snippet;
};
let { disabled = false, confirm = false, loading = false, onclose, reason, question }: Props = $props();

let asking = $state(false);

function press(): void {
	if (disabled || loading) return;
	if (confirm) asking = true;
	else onclose();
}

function accept(): void {
	asking = false;
	onclose();
}
</script>

{#snippet button(extra: { "aria-describedby"?: string })}
	<Button variant={BUTTON_VARIANT.danger} size="sm" {disabled} {loading} onclick={press} {...extra}>
		<Icon name="x-mark" size="xs" />Cerrar agente
	</Button>
{/snippet}

{#if disabled && reason}
	<Tooltip placement="bottom">
		{#snippet children(trigger)}{@render button(trigger)}{/snippet}
		{#snippet content()}{@render reason()}{/snippet}
	</Tooltip>
{:else}
	{@render button({})}
{/if}

<Modal open={asking} onclose={() => (asking = false)} size="sm">
	{#snippet title()}¿Cerrar el agente?{/snippet}
	{#snippet children()}
		<p class="text-sm text-text-secondary">{#if question}{@render question()}{/if}</p>
	{/snippet}
	{#snippet footer()}
		<Button variant={BUTTON_VARIANT.tertiary} onclick={() => (asking = false)}>Cancelar</Button>
		<Button variant={BUTTON_VARIANT.danger} onclick={accept}>Cerrar igualmente</Button>
	{/snippet}
</Modal>
