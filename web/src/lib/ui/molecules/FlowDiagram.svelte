<script lang="ts">
import Icon from "#web/lib/ui/icons/Icon.svelte";
import type { IconName } from "#web/lib/ui/icons/icons.ts";

type Step = { icon: IconName; title: string; caption: string };

// Quién habla con quién: la cadena de trabajo y, debajo, dónde queda lo que ocurre
const WORK: readonly Step[] = [
	{ icon: "command-line", title: "Claude Code", caption: "Pide y escribe" },
	{ icon: "server-stack", title: "Servidor MCP", caption: "Herramientas figma_*" },
	{ icon: "squares-2x2", title: "Chrome", caption: "Con depuración (CDP)" },
	{ icon: "swatch", title: "Figma", caption: "El archivo abierto" },
];
const RECORD: readonly Step[] = [
	{ icon: "queue-list", title: "Histórico", caption: "Base SQLite local" },
	{ icon: "chat-bubble-left-right", title: "Panel", caption: "Lo que estás viendo" },
];
</script>

{#snippet node(step: Step)}
	<div class="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface-raised px-4 py-3">
		<span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700"><Icon name={step.icon} size="md" /></span>
		<span class="min-w-0">
			<span class="block text-sm font-semibold text-text-primary">{step.title}</span>
			<span class="block text-xs text-text-muted">{step.caption}</span>
		</span>
	</div>
{/snippet}

{#snippet chain(steps: readonly Step[], label: string)}
	<ol aria-label={label} class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
		{#each steps as step, i (step.title)}
			<li class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
				{@render node(step)}
				{#if i < steps.length - 1}
					<span class="flex justify-center text-text-muted" aria-hidden="true"><span class="rotate-90 sm:rotate-0"><Icon name="chevron-right" /></span></span>
				{/if}
			</li>
		{/each}
	</ol>
{/snippet}

<figure class="flex flex-col gap-4" aria-label="Cómo se conectan las piezas">
	{@render chain(WORK, "Cadena de trabajo")}
	<div class="flex flex-col gap-2">
		<p class="text-xs text-text-muted">Cada llamada del servidor se guarda en el histórico, y el panel lo lee para enseñártelo:</p>
		{@render chain(RECORD, "Dónde queda el registro")}
	</div>
</figure>
