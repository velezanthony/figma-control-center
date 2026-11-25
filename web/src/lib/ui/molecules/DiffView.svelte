<script lang="ts">
import { hunkTitle, nextHunk } from "#web/lib/attempts/hunks.ts";
import type { DiffHunk } from "#web/lib/contract.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// diff: bloques de cambio con dos columnas de números y signo; content: un texto entero como contexto, con una sola
// columna. No conoce intentos: recibe los bloques que calcula el servidor
type Props = {
	label: string;
	hunks: readonly DiffHunk[];
	mode?: "diff" | "content";
	// El servidor mandó solo las primeras líneas; rawHref lleva al texto entero
	truncated?: boolean;
	rawHref?: string | null;
	// Demasiados cambios para compararlos
	tooLarge?: boolean;
	// Un lado (o los dos) solo guardó el hash: no hay texto que comparar
	hashOnly?: { readonly from: string | null; readonly to: string | null } | null;
};
let { label, hunks, mode = "diff", truncated = false, rawHref = null, tooLarge = false, hashOnly = null }: Props = $props();

const SIGN = { context: " ", add: "+", del: "−" } as const;
const ROW = {
	context: "text-text-primary",
	add: "bg-success-50 text-success-700",
	del: "bg-danger-50 text-danger-700",
} as const;
const SHORT_HASH = 12;

const id = $props.id();
const shown = $derived(hunks.reduce((total, h) => total + h.lines.length, 0));
let focused = $state(-1);
let announcement = $state("");
let sections: HTMLElement[] = $state([]);

function onkeydown(event: KeyboardEvent) {
	if (mode !== "diff" || event.ctrlKey || event.metaKey || event.altKey) return;
	const next = nextHunk(focused, hunks.length, event.key);
	if (next === null) return;
	event.preventDefault();
	focused = next;
	announcement = hunkTitle(hunks[next] as DiffHunk, next, hunks.length);
	sections[next]?.focus();
	sections[next]?.scrollIntoView?.({ block: "nearest" });
}
</script>

{#snippet raw()}
	{#if rawHref !== null}
		<Button variant={BUTTON_VARIANT.link} href={rawHref} target="_blank" rel="noopener noreferrer"><Icon name="arrow-top-right-on-square" size="xs" />Abrir completo</Button>
	{/if}
{/snippet}

{#if hashOnly !== null}
	<div class="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-4 text-sm text-text-secondary">
		<p class="font-semibold text-text-primary">Solo se guardó el hash (pasó de FCC_SCRIPT_MAX_BYTES)</p>
		<p>No hay texto que comparar. Si los dos hashes son distintos, el contenido cambió.</p>
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
			<dt class="text-text-muted">antes</dt><dd>{hashOnly.from === null ? "—" : hashOnly.from.slice(0, SHORT_HASH)}</dd>
			<dt class="text-text-muted">después</dt><dd>{hashOnly.to === null ? "—" : hashOnly.to.slice(0, SHORT_HASH)}</dd>
		</dl>
	</div>
{:else if tooLarge}
	<div class="flex flex-col items-start gap-2 rounded-md border border-border bg-surface-raised p-4 text-sm text-text-secondary">
		<p class="font-semibold text-text-primary">Demasiados cambios para compararlos aquí</p>
		{@render raw()}
	</div>
{:else if hunks.length === 0}
	<p class="rounded-md border border-border bg-surface-raised p-4 text-sm text-text-secondary">Sin líneas que mostrar</p>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		role="region"
		aria-label={label}
		tabindex="0"
		{onkeydown}
		class="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
	>
		<p role="status" class="sr-only">{announcement}</p>
		{#each hunks as hunk, i (i)}
			<section
				bind:this={sections[i]}
				tabindex="-1"
				aria-labelledby={mode === "diff" ? `${id}-h${i}` : undefined}
				onfocusin={() => (focused = i)}
				class="rounded-md outline-offset-2"
			>
				{#if mode === "diff"}
					<h4 id="{id}-h{i}" class="mb-1 text-xs font-medium text-text-muted">{hunkTitle(hunk, i, hunks.length)}</h4>
				{/if}
				<pre class="overflow-x-auto rounded-md border border-border font-mono text-xs leading-5">{#each hunk.lines as l, k (k)}<code data-op={l.op} class="flex min-w-max {ROW[l.op]}">{#if mode === "diff"}<span data-old aria-hidden="true" class="w-12 shrink-0 px-2 text-right select-none {l.op === 'context' ? 'text-text-muted' : ''}">{l.oldNo ?? ""}</span>{/if}<span data-new aria-hidden="true" class="w-12 shrink-0 px-2 text-right select-none {l.op === 'context' ? 'text-text-muted' : ''}">{l.newNo ?? ""}</span>{#if mode === "diff"}<span class="w-5 shrink-0 text-center font-semibold select-none">{SIGN[l.op]}</span>{/if}<span class="pr-3 whitespace-pre {mode === 'diff' ? '' : 'pl-3'}">{l.text}</span></code>{/each}</pre>
			</section>
		{/each}
		{#if mode === "diff"}<p class="text-xs text-text-muted">Con el foco aquí, <kbd class="rounded-sm border border-b-2 border-border bg-canvas px-1 font-mono">n</kbd> y <kbd class="rounded-sm border border-b-2 border-border bg-canvas px-1 font-mono">p</kbd> saltan al cambio siguiente y al anterior.</p>{/if}
		{#if truncated}
			<div class="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
				<span>Recortado: se muestran las primeras {shown} líneas.</span>
				{@render raw()}
			</div>
		{/if}
	</div>
{/if}
