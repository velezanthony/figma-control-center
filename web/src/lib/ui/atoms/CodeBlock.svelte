<script lang="ts">
import type { Snippet } from "svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

type Size = "sm" | "md";
// wrap: las líneas largas (rutas, JSON) se parten al ancho del bloque en vez de sacar scroll horizontal.
// collapse: crece con el contenido, sin tope ni scroll propio (va dentro de otra lista con scroll); si no cabe en seis
// líneas se recorta y «Ver todo» lo despliega. Implica wrap; «Copiar» va debajo, a todo el ancho del texto
type Props = { size?: Size; wrap?: boolean; collapse?: boolean; children: Snippet };

let { size = "md", wrap = false, collapse = false, children }: Props = $props();

const COPIED_FEEDBACK_MS = 1500;
const SIZE: Record<Size, string> = {
	sm: "text-[0.6875rem]",
	md: "text-xs",
};
// Tope con scroll propio: solo sin collapse
const MAX_HEIGHT: Record<Size, string> = {
	sm: "max-h-40 overflow-auto",
	md: "max-h-80 overflow-auto",
};
const WRAP = "whitespace-pre-wrap wrap-anywhere";
const CLAMPED = "line-clamp-6";

const id = $props.id();
let block: HTMLPreElement | undefined = $state();
// Lo que se recorta en collapse: el código, no la caja (el relleno de la caja dejaría asomar la séptima línea)
let lines: HTMLElement | undefined = $state();
let copied = $state(false);
let expanded = $state(false);
// El control solo sale si de verdad no cabe (se mide recortado y al cambiar el ancho)
let clamped = $state(false);

$effect(() => {
	const el = lines;
	if (el === undefined || !collapse || expanded) return;
	const measure = () => {
		clamped = el.scrollHeight > el.clientHeight;
	};
	measure();
	const observer = new ResizeObserver(measure);
	observer.observe(el);
	return () => observer.disconnect();
});
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
	try {
		await navigator.clipboard.writeText(block?.textContent ?? "");
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), COPIED_FEEDBACK_MS);
	} catch {
		// sin permiso de portapapeles: el texto sigue seleccionable a mano
	}
}
</script>

{#snippet copyButton()}
	<Button variant={BUTTON_VARIANT.secondary} size="sm" onclick={copy}>
		<Icon name={copied ? "check" : "document-duplicate"} size="xs" />
		{copied ? "Copiado" : "Copiar"}
	</Button>
{/snippet}

{#if collapse}
	<div class="flex flex-col gap-2">
		<pre
			bind:this={block}
			id="{id}-code"
			class="rounded-md border border-border bg-surface-raised p-4 font-mono leading-relaxed text-text-primary {SIZE[size]} {WRAP}"><code bind:this={lines} class={expanded ? 'block' : CLAMPED}>{@render children()}</code></pre>
		<div class="flex flex-wrap items-center gap-3">
			{@render copyButton()}
			{#if clamped || expanded}
				<Button variant={BUTTON_VARIANT.link} size="sm" aria-expanded={expanded} aria-controls="{id}-code" onclick={() => (expanded = !expanded)}>
					{expanded ? "Ver menos" : "Ver todo"}
				</Button>
			{/if}
		</div>
	</div>
{:else}
	<div class="relative">
		<!-- svelte-ignore a11y_no_noninteractive_tabindex: una región con scroll debe poder enfocarse para desplazarla con teclado -->
		<pre
			bind:this={block}
			tabindex="0"
			class="rounded-md border border-border bg-surface-raised p-4 pr-24 font-mono leading-relaxed text-text-primary {SIZE[size]} {MAX_HEIGHT[size]} {wrap ? WRAP : ''}"><code>{@render children()}</code></pre>
		<div class="absolute top-2 right-2">{@render copyButton()}</div>
	</div>
{/if}
