<script module lang="ts">
// Variantes de EmptyState como fuente única: la unión se deriva del token, no se declara aparte.
export const EMPTY_STATE_VARIANT = {
	neutral: "neutral",
	error: "error",
} as const;
export type EmptyStateVariant = (typeof EMPTY_STATE_VARIANT)[keyof typeof EMPTY_STATE_VARIANT];
</script>

<script lang="ts">
import type { Snippet } from "svelte";

// md: tarjeta propia; sm: incrustado dentro de otra superficie (una tabla), sin borde
type Size = "sm" | "md";
type Props = {
	variant?: EmptyStateVariant;
	size?: Size;
	icon?: Snippet;
	description?: Snippet;
	actions?: Snippet;
	children: Snippet;
};

let { variant = EMPTY_STATE_VARIANT.neutral, size = "md", icon, description, actions, children }: Props = $props();

const ICON: Record<EmptyStateVariant, string> = { neutral: "text-text-muted", error: "text-danger-700" };
const SIZE: Record<Size, string> = {
	sm: "p-8",
	md: "rounded-xl border border-border bg-surface p-12 shadow-xs",
};
</script>

<div class="flex flex-col items-center text-center {SIZE[size]}">
	{#if icon}<div class="mb-4 {ICON[variant]}">{@render icon()}</div>{/if}
	<div class="text-lg font-semibold text-text-primary">{@render children()}</div>
	{#if description}<div class="mt-1 max-w-prose text-sm text-text-secondary">{@render description()}</div>{/if}
	{#if actions}<div class="mt-4 flex items-center gap-2">{@render actions()}</div>{/if}
</div>
