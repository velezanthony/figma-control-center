<script module lang="ts">
// Variantes de Badge como fuente única: la unión se deriva del token, no se declara aparte.
export const BADGE_VARIANT = {
	primary: "primary",
	secondary: "secondary",
	success: "success",
	danger: "danger",
	warning: "warning",
	info: "info",
} as const;
export type BadgeVariant = (typeof BADGE_VARIANT)[keyof typeof BADGE_VARIANT];
</script>

<script lang="ts">
import type { Snippet } from "svelte";

type Size = "sm" | "md" | "lg";
// dot: punto de estado delante del texto
type Props = { variant?: BadgeVariant; size?: Size; dot?: boolean; children: Snippet };

let { variant = BADGE_VARIANT.secondary, size = "md", dot = false, children }: Props = $props();

const VARIANT: Record<BadgeVariant, string> = {
	primary: "border-brand-200 bg-brand-100 text-brand-700",
	secondary: "border-border bg-surface-sunken text-text-secondary",
	success: "border-success-200 bg-success-100 text-success-700",
	danger: "border-danger-200 bg-danger-100 text-danger-700",
	warning: "border-warning-200 bg-warning-100 text-warning-700",
	info: "border-info-200 bg-info-100 text-info-700",
};

const DOT: Record<BadgeVariant, string> = {
	primary: "bg-brand-500",
	secondary: "bg-border-strong",
	success: "bg-success-500",
	danger: "bg-danger-500",
	warning: "bg-warning-500",
	info: "bg-info-500",
};

const SIZE: Record<Size, string> = {
	sm: "px-1.5 py-px text-xs",
	md: "px-2.5 py-0.5 text-xs",
	lg: "px-3 py-1 text-sm",
};
</script>

<span class="inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap {VARIANT[variant]} {SIZE[size]}">
	{#if dot}<span aria-hidden="true" class="size-2 shrink-0 rounded-full {DOT[variant]}"></span>{/if}
	{@render children()}
</span>
