<script lang="ts">
import type { Snippet } from "svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";

type ValueTone = "primary" | "success" | "warning" | "brand" | "danger" | "muted";
type Props = {
	valueTone?: ValueTone;
	value: string;
	unit?: string;
	// Título, icono monocromático, nota bajo el valor y ayuda (tooltip «?») por snippets
	title: Snippet;
	icon?: Snippet;
	description?: Snippet;
	help?: Snippet;
};

let { valueTone = "primary", value, unit, title, icon, description, help }: Props = $props();

const VALUE: Record<ValueTone, string> = {
	primary: "text-text-primary",
	success: "text-success-700",
	warning: "text-warning-700",
	brand: "text-brand-700",
	danger: "text-danger-700",
	muted: "text-text-muted",
};

// El icono va en un chip tintado del mismo tono (patrón «chip de icono»: bg-X-50 text-X-700)
const CHIP: Record<ValueTone, string> = {
	primary: "bg-brand-50 text-brand-700",
	success: "bg-success-50 text-success-700",
	warning: "bg-warning-50 text-warning-700",
	brand: "bg-brand-50 text-brand-700",
	danger: "bg-danger-50 text-danger-700",
	muted: "bg-surface-sunken text-text-muted",
};
</script>

<div class="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-xs transition-colors duration-base hover:border-border-strong">
	<div class="flex items-start justify-between gap-3">
		<div class="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-text-muted uppercase">
			{@render title()}
			{#if help}
				<Tooltip>
					{#snippet children(trigger)}
						<button
							type="button"
							aria-label="Más información"
							class="flex size-4 cursor-pointer items-center justify-center rounded-full bg-surface-sunken text-[10px] font-bold text-text-muted transition-colors hover:bg-border"
							{...trigger}>?</button
						>
					{/snippet}
					{#snippet content()}{@render help()}{/snippet}
				</Tooltip>
			{/if}
		</div>
		{#if icon}<span class="flex size-9 shrink-0 items-center justify-center rounded-md {CHIP[valueTone]}">{@render icon()}</span>{/if}
	</div>
	<div class="flex items-baseline gap-1.5">
		<span class="text-stat tabular-nums {VALUE[valueTone]}">{value}</span>
		{#if unit}<span class="text-sm font-medium text-text-muted">{unit}</span>{/if}
	</div>
	{#if description}<div class="mt-auto text-xs text-text-muted">{@render description()}</div>{/if}
</div>
