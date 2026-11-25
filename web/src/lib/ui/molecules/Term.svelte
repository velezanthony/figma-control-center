<script module lang="ts">
// Variantes de Term como fuente única: la unión se deriva del token, no se declara aparte.
// text: el contenido se subraya con puntos (señal de que se puede preguntar); bare: sin subrayado (badges, ids)
export const TERM_VARIANT = {
	text: "text",
	bare: "bare",
} as const;
export type TermVariant = (typeof TERM_VARIANT)[keyof typeof TERM_VARIANT];
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import { termOf } from "#web/lib/glossary/terms.ts";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";

type Props = {
	// Clave del glosario (lib/glossary/terms.ts). Una clave que no existe deja el contenido tal cual
	term: string;
	variant?: TermVariant;
	children: Snippet;
};

let { term, variant = TERM_VARIANT.text, children: body }: Props = $props();

const definition = $derived(termOf(term));
const VARIANT: Record<TermVariant, string> = {
	text: "underline decoration-dotted decoration-text-muted underline-offset-4",
	bare: "",
};
</script>

{#if definition}
	<Tooltip>
		{#snippet children(trigger)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex: el disparador de un tooltip debe poder enfocarse con teclado -->
			<span tabindex="0" class="cursor-help rounded-sm {VARIANT[variant]}" {...trigger}>{@render body()}</span>
		{/snippet}
		{#snippet content()}<span class="font-semibold">{definition.label}.</span> {definition.short}{/snippet}
	</Tooltip>
{:else}
	{@render body()}
{/if}
