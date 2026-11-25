<script lang="ts">
import type { Snippet } from "svelte";

type State = "ok" | "error" | "warning" | "info" | "idle" | "running";
type Size = "sm" | "md";
type Props = { state?: State; size?: Size; children: Snippet };

let { state = "idle", size = "md", children }: Props = $props();

// Un punto nunca va solo: el estado se dice también con texto (children)
const STATE: Record<State, string> = {
	ok: "bg-success-500",
	error: "bg-danger-500",
	warning: "bg-warning-500",
	info: "bg-info-500",
	idle: "bg-border-strong",
	running: "bg-brand-500 motion-safe:animate-pulse",
};

const SIZE: Record<Size, string> = { sm: "size-1.5", md: "size-2" };
</script>

<span class="inline-flex items-center gap-2 text-sm text-text-secondary">
	<span aria-hidden="true" class="shrink-0 rounded-full {STATE[state]} {SIZE[size]}"></span>
	{@render children()}
</span>
