<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLSelectAttributes } from "svelte/elements";
import Icon from "#web/lib/ui/icons/Icon.svelte";

type Size = "sm" | "md" | "lg";
type Props = Omit<HTMLSelectAttributes, "children" | "class" | "value" | "size"> & {
	value?: string;
	size?: Size;
	invalid?: boolean;
	// Etiqueta visible; sin ella, el selector necesita aria-label
	label?: Snippet;
	// Solo el icono (el selector real queda encima, transparente): cabe en una barra contraída y sigue siendo un <select>
	compact?: boolean;
	// Icono que se ve cuando es compact
	icon?: Snippet;
	// Las <option>
	children: Snippet;
};

let { value = $bindable(""), size = "md", invalid = false, compact = false, icon, label, children, ...rest }: Props = $props();

const SIZE: Record<Size, string> = {
	sm: "px-2.5 py-1.5 pr-9 text-xs",
	md: "px-2.5 py-1.75 pr-9 text-sm",
	lg: "px-4 py-3 pr-10 text-base",
};
const STATE = {
	valid: "border-border hover:border-border-strong/40 disabled:hover:border-border focus:border-brand-500 focus:ring-brand-500/15",
	invalid: "border-danger-500 focus:border-danger-500 focus:ring-danger-500/15",
} as const;
</script>

{#if compact}
	<label class="relative flex justify-center rounded-md text-text-muted outline-offset-2 has-focus-visible:outline-2 has-focus-visible:outline-focus">
		{#if icon}{@render icon()}{/if}
		<select bind:value class="absolute inset-0 size-full cursor-pointer appearance-none opacity-0" {...rest}>
			{@render children()}
		</select>
	</label>
{:else}
<label class="flex flex-col gap-1.5">
	{#if label}<span class="text-sm font-medium text-text-primary">{@render label()}</span>{/if}
	<span class="relative flex items-center">
		<select
			bind:value
			aria-invalid={invalid || undefined}
			class="w-full cursor-pointer appearance-none truncate rounded-md border bg-surface text-text-primary transition duration-base focus:ring-3 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-secondary {SIZE[size]} {invalid ? STATE.invalid : STATE.valid}"
			{...rest}
		>
			{@render children()}
		</select>
		<span class="pointer-events-none absolute right-2.5 text-text-muted"><Icon name="chevron-down" size="sm" /></span>
	</span>
</label>
{/if}
