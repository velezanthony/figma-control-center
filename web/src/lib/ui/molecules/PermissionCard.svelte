<script lang="ts">
import { compactInput, EXPIRED_HINT, STATUS_LABEL, STATUS_TONE } from "#web/lib/chat/permissions.ts";
import type { PermissionStatus } from "#web/lib/contract.ts";
import Badge from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import CodeBlock from "#web/lib/ui/atoms/CodeBlock.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// Una petición de permiso de Claude Code: qué herramienta quiere usar y, si está pendiente, los botones para
// contestar. Descripción y entrada llegan del canal y se pintan siempre como texto
type Props = {
	tool: string;
	description: string;
	input: string;
	status: PermissionStatus;
	time: string;
	// Se está enviando la respuesta: los botones esperan
	busy?: boolean;
	onallow: () => void;
	ondeny: () => void;
};
let { tool, description, input, status, time, busy = false, onallow, ondeny }: Props = $props();

const id = $props.id();
let card: HTMLElement | undefined = $state();
let descriptionText: HTMLElement | undefined = $state();
// La descripción es la de la herramienta, escrita para Claude: se recorta a dos líneas y «Ver más» la despliega.
// El control solo sale si de verdad no cabe (se mide recortada y al cambiar el ancho)
let expanded = $state(false);
let clamped = $state(false);
const compact = $derived(compactInput(input));

$effect(() => {
	const el = descriptionText;
	if (el === undefined || expanded) return;
	const measure = () => {
		clamped = el.scrollHeight > el.clientHeight;
	};
	measure();
	const observer = new ResizeObserver(measure);
	observer.observe(el);
	return () => observer.disconnect();
});

// Al contestarse, los botones desaparecen: si el foco estaba en ellos se queda en la tarjeta en vez de caer a la página
let previous: PermissionStatus | undefined;
$effect(() => {
	const now = status;
	const lostFocus = document.activeElement === document.body || card?.contains(document.activeElement);
	if (previous === "pending" && now !== "pending" && lostFocus) card?.focus();
	previous = now;
});
</script>

<article bind:this={card} tabindex="-1" aria-labelledby="{id}-title" class="flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-xs {status === 'pending' ? 'border-warning-200' : 'border-border'}">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
		<span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-warning-50 text-warning-700" aria-hidden="true"><Icon name="command-line" size="sm" /></span>
		<h3 id="{id}-title" class="min-w-0 flex-1 basis-48 text-sm font-semibold text-text-primary">
			Claude pide permiso para usar <span class="font-mono">{tool}</span>
		</h3>
		<Badge variant={STATUS_TONE[status]} size="sm" dot>{STATUS_LABEL[status]}</Badge>
		<time class="font-mono text-[11px] text-text-muted">{time}</time>
	</div>
	{#if description}
		<div class="flex flex-col items-start gap-1">
			<p bind:this={descriptionText} id="{id}-description" class="text-sm break-words whitespace-pre-wrap text-text-secondary {expanded ? '' : 'line-clamp-2'}">{description}</p>
			{#if clamped}
				<Button variant={BUTTON_VARIANT.link} size="sm" aria-expanded={expanded} aria-controls="{id}-description" onclick={() => (expanded = !expanded)}>
					{expanded ? "Ver menos" : "Ver más"}
				</Button>
			{/if}
		</div>
	{/if}
	{#if input}
		<CodeBlock size="sm" collapse>{compact}</CodeBlock>
	{/if}
	{#if status === "pending"}
		<div class="flex flex-wrap gap-2">
			<Button variant={BUTTON_VARIANT.primary} size="sm" loading={busy} disabled={busy} onclick={onallow}><Icon name="check" size="xs" />Aprobar</Button>
			<Button variant={BUTTON_VARIANT.danger} size="sm" disabled={busy} onclick={ondeny}><Icon name="x-mark" size="xs" />Denegar</Button>
		</div>
	{:else if status === "expired"}
		<p class="text-xs text-text-muted">{EXPIRED_HINT}</p>
	{/if}
</article>
