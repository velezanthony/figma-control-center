<script lang="ts">
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";
import Modal from "#web/lib/ui/molecules/Modal.svelte";

// «Restablecer todo» de la pantalla de Ajustes (D-10): devuelve a su valor por defecto todo lo guardado en el panel.
// Afecta a varios ajustes a la vez, así que pregunta antes y lista cuáles; el «Restablecer» de cada fila no (D-7).
// Solo avisa con `onreset`: quien lo usa hace la llamada al servidor.
type Props = {
	// Nombre de cada ajuste con algo guardado; vacío = nada que restablecer (botón desactivado)
	names: readonly string[];
	busy: boolean;
	onreset: () => void;
};
let { names, busy, onreset }: Props = $props();

let asking = $state(false);
const nothing = $derived(names.length === 0);
const count = $derived(names.length === 1 ? "1 ajuste" : `${names.length} ajustes`);

function accept(): void {
	asking = false;
	onreset();
}
</script>

{#snippet button(extra: { "aria-describedby"?: string })}
	<Button variant={BUTTON_VARIANT.tertiary} size="sm" disabled={nothing} loading={busy} onclick={() => (asking = true)} {...extra}>Restablecer todo</Button>
{/snippet}

{#if nothing}
	<Tooltip placement="bottom">
		{#snippet children(trigger)}{@render button(trigger)}{/snippet}
		{#snippet content()}No hay ningún ajuste guardado en el panel{/snippet}
	</Tooltip>
{:else}
	{@render button({})}
{/if}

<Modal open={asking} onclose={() => (asking = false)} size="sm">
	{#snippet title()}¿Restablecer todos los ajustes?{/snippet}
	{#snippet children()}
		<p class="text-sm text-text-secondary">{count} guardado{names.length === 1 ? "" : "s"} en el panel volverá{names.length === 1 ? "" : "n"} a su valor por defecto (o al del entorno, si lo fija):</p>
		<ul class="mt-2 list-disc space-y-0.5 pl-5 text-sm text-text-primary">
			{#each names as name (name)}<li>{name}</li>{/each}
		</ul>
	{/snippet}
	{#snippet footer()}
		<Button variant={BUTTON_VARIANT.tertiary} onclick={() => (asking = false)}>Cancelar</Button>
		<Button variant={BUTTON_VARIANT.danger} onclick={accept}>Restablecer todo</Button>
	{/snippet}
</Modal>
