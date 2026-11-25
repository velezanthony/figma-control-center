<script lang="ts">
import type { Block, Inline } from "#web/lib/chat/markdown.ts";
import { refHref, refLabel } from "#web/lib/chat/ref-links.ts";
import CodeBlock from "#web/lib/ui/atoms/CodeBlock.svelte";
import Highlighted from "#web/lib/ui/atoms/Highlighted.svelte";
import RefChip from "#web/lib/ui/atoms/RefChip.svelte";

// Pinta el árbol de `parseMarkdown` con elementos propios: nada de {@html}, así que lo que venga en la respuesta
// (texto de herramientas incluido) nunca se interpreta como HTML
type Props = {
	blocks: readonly Block[];
	// Archivo de Figma de la sesión: sin él, los ids de nodo salen como texto
	fileUrl?: string | null;
	// Lo buscado: se resalta dentro de los textos (nunca de la estructura); vacío, nada
	highlight?: string;
	// El mensaje en el que está el cursor de la búsqueda
	active?: boolean;
};
let { blocks: tree, fileUrl = null, highlight = "", active = false }: Props = $props();

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;
const HEADING = ["text-lg font-bold", "text-base font-bold", "text-base font-semibold", "text-sm font-semibold"] as const;
const SEMANTIC_LEVELS = 4;
</script>

{#snippet marked(text: string)}{#if highlight === ""}{text}{:else}<Highlighted {text} query={highlight} {active} />{/if}{/snippet}

{#snippet inline(nodes: readonly Inline[])}
	{#each nodes as n, i (i)}{#if n.t === "text"}{@render marked(n.text)}{:else if n.t === "br"}<br />{:else if n.t === "strong"}<strong class="font-semibold text-text-primary">{@render inline(n.children)}</strong>{:else if n.t === "em"}<em>{@render inline(n.children)}</em>{:else if n.t === "del"}<del>{@render inline(n.children)}</del>{:else if n.t === "code"}<code class="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.85em] break-words">{@render marked(n.text)}</code>{:else if n.t === "link"}<a href={n.href} target="_blank" rel="noopener noreferrer" class="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-700">{@render inline(n.children)}</a>{:else}<RefChip href={refHref(n, fileUrl)} label={refLabel(n)} title={n.id} chip={n.code} external={n.t === "node"} />{/if}{/each}
{/snippet}

{#snippet render(list: readonly Block[])}
	{#each list as b, i (i)}
		{#if b.t === "p"}
			<p class="break-words">{@render inline(b.children)}</p>
		{:else if b.t === "heading"}
			<svelte:element this={b.level <= 2 ? "h3" : "h4"} class="mt-2 text-text-primary {HEADING[Math.min(b.level, SEMANTIC_LEVELS) - 1]}">{@render inline(b.children)}</svelte:element>
		{:else if b.t === "fence"}
			<CodeBlock>{@render marked(b.text)}</CodeBlock>
		{:else if b.t === "list"}
			<svelte:element this={b.ordered ? "ol" : "ul"} start={b.ordered ? b.start : undefined} class="pl-6 [&>li+li]:mt-1.5 [&_ul]:list-[circle] [&_ul_ul]:list-[square] {b.ordered ? 'list-decimal' : 'list-disc'} marker:text-text-muted">
				{#each b.items as item, j (j)}
					<li class="pl-1 [&>*+*]:mt-1.5">{@render render(item)}</li>
				{/each}
			</svelte:element>
		{:else if b.t === "quote"}
			<blockquote class="flex flex-col gap-3 border-l-2 border-border-strong pl-4 text-text-secondary">{@render render(b.children)}</blockquote>
		{:else if b.t === "table"}
			<div class="overflow-x-auto rounded-md border border-border">
				<table class="w-full border-collapse text-sm">
					<thead class="bg-surface-raised">
						<tr>
							{#each b.head as cell, c (c)}
								<th class="border-b border-border px-3 py-2 text-xs font-semibold text-text-primary {ALIGN[b.align[c] ?? 'left']}">{@render inline(cell)}</th>
							{/each}
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each b.rows as row, r (r)}
							<tr>
								{#each row as cell, c (c)}
									<td class="px-3 py-2 align-top {ALIGN[b.align[c] ?? 'left']}">{@render inline(cell)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<hr class="border-border" />
		{/if}
	{/each}
{/snippet}

<div class="flex flex-col gap-3 text-sm leading-7 text-text-primary">{@render render(tree)}</div>
