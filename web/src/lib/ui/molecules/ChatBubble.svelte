<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// in: lo que escribe el usuario del panel (burbuja a la derecha) · out: la respuesta de Claude (a la izquierda,
// sin burbuja, con su marca y su nombre)
type Direction = "in" | "out";
type MetaTone = "muted" | "danger";
type Props = {
	direction: Direction;
	time: string;
	// Estado de entrega u otra nota breve junto a la hora
	meta?: string | undefined;
	metaTone?: MetaTone;
	children: Snippet;
};

let { direction, time, meta, metaTone = "muted", children }: Props = $props();

const META: Record<MetaTone, string> = { muted: "text-text-muted", danger: "text-danger-700" };
</script>

{#snippet footer()}
	<div class="flex items-center gap-1.5 text-[11px] {META.muted}">
		<time class="font-mono">{time}</time>
		{#if meta}<span aria-hidden="true">·</span><span class={META[metaTone]}>{meta}</span>{/if}
	</div>
{/snippet}

{#if direction === "in"}
	<div class="flex flex-col items-end gap-1">
		<div class="max-w-[85%] rounded-2xl rounded-br-md border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-text-primary">
			{@render children()}
		</div>
		{@render footer()}
	</div>
{:else}
	<div class="flex gap-3">
		<span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700" aria-hidden="true"><Icon name="sparkles" size="sm" /></span>
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<span class="text-sm font-semibold text-text-primary">Claude</span>
			<div class="min-w-0">{@render children()}</div>
			{@render footer()}
		</div>
	</div>
{/if}
