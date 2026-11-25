<script lang="ts">
import { onMount } from "svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// Barra de búsqueda dentro del chat (sustituye a Ctrl+F, que no ve los mensajes sin montar). Intro: siguiente;
// Mayús+Intro: anterior; Escape: cerrar. El recuento se anuncia a los lectores de pantalla
type Props = {
	query: string;
	// «3 de 12», «Sin resultados», «Buscando…»
	label: string;
	hasResults: boolean;
	onquery: (value: string) => void;
	onnext: () => void;
	onprevious: () => void;
	onclose: () => void;
};
let { query, label, hasResults, onquery, onnext, onprevious, onclose }: Props = $props();

let field: HTMLInputElement | undefined = $state();
onMount(() => {
	field?.focus();
	field?.select();
});

function onkeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		onclose();
	} else if (event.key === "Enter" && !event.isComposing) {
		event.preventDefault();
		if (event.shiftKey) onprevious();
		else onnext();
	}
}
</script>

<div role="search" class="flex items-center gap-1.5 rounded-xl border border-border bg-surface p-1.5 shadow-md transition duration-base focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15">
	<span class="pl-1.5 text-text-muted"><Icon name="magnifying-glass" size="sm" /></span>
	<input
		bind:this={field}
		type="search"
		name="buscar-conversacion"
		value={query}
		oninput={(e) => onquery(e.currentTarget.value)}
		{onkeydown}
		maxlength={200}
		autocomplete="off"
		spellcheck="false"
		aria-label="Buscar en la conversación"
		placeholder="Buscar en la conversación"
		class="w-40 min-w-0 bg-transparent px-1 py-1 text-sm text-text-primary outline-none placeholder:text-text-muted sm:w-56 [&::-webkit-search-cancel-button]:hidden"
	/>
	<span class="min-w-16 text-right font-mono text-xs whitespace-nowrap text-text-muted">{label}</span>
	<Button variant={BUTTON_VARIANT.ghost} shape="icon" size="sm" aria-label="Resultado anterior" disabled={!hasResults} onclick={onprevious}><Icon name="chevron-up" /></Button>
	<Button variant={BUTTON_VARIANT.ghost} shape="icon" size="sm" aria-label="Resultado siguiente" disabled={!hasResults} onclick={onnext}><Icon name="chevron-down" /></Button>
	<Button variant={BUTTON_VARIANT.ghost} shape="icon" size="sm" aria-label="Cerrar la búsqueda" onclick={onclose}><Icon name="x-mark" /></Button>
	<span class="sr-only" role="status" aria-live="polite">{label}</span>
</div>
