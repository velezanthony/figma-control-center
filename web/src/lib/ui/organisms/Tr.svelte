<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// expandable: la fila se despliega (clic en la fila o botón con Enter/Espacio)
type Props = {
	id: string;
	expandable?: boolean;
	expanded?: boolean;
	// Fila que acaba de llegar en vivo: se resalta un instante
	highlight?: boolean;
	ontoggle?: () => void;
	// Clic en la fila: abre otra vista (el teclado lo cubre un botón dentro de la fila)
	onopen?: (() => void) | undefined;
	toggleLabel?: string;
	children: Snippet;
};

let { id, expandable = false, expanded = false, highlight = false, ontoggle, onopen, toggleLabel = "Ver detalle", children }: Props = $props();

const INTERACTIVE = "a, button, input, select, [role='menu']";

function onrowclick(event: MouseEvent) {
	if (!expandable && onopen === undefined) return;
	if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
	if (expandable) ontoggle?.();
	else onopen?.();
}
</script>

<!-- El teclado lo cubre el botón de la última celda; el clic en la fila es una comodidad de ratón -->
<tr
	{id}
	onclick={onrowclick}
	class="transition-colors hover:bg-surface-raised max-md:block max-md:rounded-xl max-md:border max-md:border-border max-md:bg-surface max-md:p-4 {expandable || onopen !== undefined ? 'cursor-pointer' : ''} {expanded ? 'bg-surface-raised' : ''} {highlight ? 'animate-row-flash' : ''}"
>
	{@render children()}
	{#if expandable}
		<td class="w-px px-4 py-2.5 max-md:flex max-md:justify-end max-md:px-0 max-md:py-1">
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls="{id}-detail"
				aria-label={toggleLabel}
				onclick={ontoggle}
				class="flex size-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-sunken hover:text-text-primary"
			>
				<span class="transition-transform duration-base {expanded ? 'rotate-180' : ''}"><Icon name="chevron-down" /></span>
			</button>
		</td>
	{/if}
</tr>
