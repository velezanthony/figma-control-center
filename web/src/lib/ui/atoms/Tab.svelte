<script module lang="ts">
// Variantes de Tab como fuente única: la unión se deriva del token, no se declara aparte.
export const TAB_VARIANT = {
	underline: "underline",
	segmented: "segmented",
} as const;
export type TabVariant = (typeof TAB_VARIANT)[keyof typeof TAB_VARIANT];
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLButtonAttributes } from "svelte/elements";

type Size = "sm" | "md";
type Props = Omit<HTMLButtonAttributes, "children" | "class" | "role"> & {
	variant?: TabVariant;
	size?: Size;
	selected?: boolean;
	// Contador opcional junto al texto (solo underline)
	count?: number | undefined;
	children: Snippet;
};

let { variant = TAB_VARIANT.underline, size = "md", selected = false, count, type = "button", children, ...rest }: Props = $props();

const BASE = {
	underline: "inline-flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-4 py-3 text-sm whitespace-nowrap transition duration-base cursor-pointer focus-visible:-outline-offset-2",
	segmented: "rounded-sm font-medium transition duration-base cursor-pointer",
} as const;
const STATE = {
	underline: {
		on: "border-brand-600 font-semibold text-brand-700",
		off: "border-transparent font-medium text-text-muted hover:bg-surface-raised hover:text-text-primary",
	},
	segmented: {
		on: "bg-surface font-semibold text-brand-700 shadow-xs ring-1 ring-border",
		off: "text-text-secondary hover:bg-surface hover:text-text-primary",
	},
} as const;
const SEGMENTED_SIZE: Record<Size, string> = { sm: "px-2.5 py-1 text-xs", md: "px-3 py-1.5 text-xs" };
</script>

<button
	{type}
	role="tab"
	aria-selected={selected}
	tabindex={selected ? 0 : -1}
	class="{BASE[variant]} {variant === TAB_VARIANT.segmented ? SEGMENTED_SIZE[size] : ''} {selected ? STATE[variant].on : STATE[variant].off}"
	{...rest}
>
	{@render children()}
	{#if count !== undefined && variant === TAB_VARIANT.underline}
		<span class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums {selected ? 'bg-brand-50 text-brand-700' : 'bg-surface-sunken text-text-secondary'}">{count}</span>
	{/if}
</button>
