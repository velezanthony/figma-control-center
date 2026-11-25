<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLInputAttributes } from "svelte/elements";

type Size = "sm" | "md" | "lg";
type Props = Omit<HTMLInputAttributes, "class" | "size" | "value"> & {
	value?: string;
	size?: Size;
	invalid?: boolean;
	// Icono a la izquierda (decorativo)
	icon?: Snippet;
	// Control a la derecha (p. ej. «limpiar»)
	trailing?: Snippet;
};

let { value = $bindable(""), size = "md", invalid = false, icon, trailing, type = "text", ...rest }: Props = $props();

const SIZE: Record<Size, string> = {
	sm: "px-2.5 py-1.5 text-xs",
	md: "px-2.5 py-1.75 text-sm",
	lg: "px-4 py-3 text-base",
};
const SIZE_WITH_ICON: Record<Size, string> = { sm: "pl-7", md: "pl-9", lg: "pl-10" };
const ICON_POSITION: Record<Size, string> = { sm: "left-2", md: "left-3", lg: "left-3.5" };
const STATE = {
	valid: "border-border hover:border-border-strong/40 disabled:hover:border-border focus:border-brand-500 focus:ring-brand-500/15",
	invalid: "border-danger-500 focus:border-danger-500 focus:ring-danger-500/15",
} as const;
</script>

<div class="relative flex items-center">
	{#if icon}
		<span class="pointer-events-none absolute text-text-muted {ICON_POSITION[size]}">{@render icon()}</span>
	{/if}
	<input
		{type}
		bind:value
		aria-invalid={invalid || undefined}
		class="w-full rounded-md border bg-surface text-text-primary transition duration-base placeholder:text-text-muted focus:ring-3 focus:outline-none read-only:cursor-default disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-secondary {SIZE[size]} {icon ? SIZE_WITH_ICON[size] : ''} {trailing ? 'pr-9' : ''} {invalid ? STATE.invalid : STATE.valid}"
		{...rest}
	/>
	{#if trailing}<span class="absolute right-1.5 flex items-center">{@render trailing()}</span>{/if}
</div>
