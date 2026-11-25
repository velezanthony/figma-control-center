<script lang="ts">
import type { HTMLTextareaAttributes } from "svelte/elements";

type Size = "sm" | "md" | "lg";
type Props = Omit<HTMLTextareaAttributes, "class" | "value"> & {
	value?: string;
	size?: Size;
	invalid?: boolean;
	// Tipografía monoespaciada: rutas, código
	mono?: boolean;
};

let { value = $bindable(""), size = "md", invalid = false, mono = false, rows = 3, ...rest }: Props = $props();

const SIZE: Record<Size, string> = {
	sm: "px-2.5 py-1.5 text-xs",
	md: "px-2.5 py-1.75 text-sm",
	lg: "px-4 py-3 text-base",
};
const STATE = {
	valid: "border-border hover:border-border-strong/40 disabled:hover:border-border focus:border-brand-500 focus:ring-brand-500/15",
	invalid: "border-danger-500 focus:border-danger-500 focus:ring-danger-500/15",
} as const;
</script>

<textarea
	bind:value
	{rows}
	aria-invalid={invalid || undefined}
	class="w-full resize-y rounded-md border bg-surface text-text-primary transition duration-base placeholder:text-text-muted focus:ring-3 focus:outline-none read-only:cursor-default disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-secondary {SIZE[size]} {mono ? 'font-mono' : ''} {invalid ? STATE.invalid : STATE.valid}"
	{...rest}
></textarea>
