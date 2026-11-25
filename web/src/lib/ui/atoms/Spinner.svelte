<script lang="ts">
type Size = "sm" | "md" | "lg";
type Props = { size?: Size };

let { size = "sm" }: Props = $props();

const SIZE: Record<Size, string> = {
	sm: "size-4 border-2",
	md: "size-5 border-2",
	lg: "size-8 border-[3px]",
};
</script>

<span
	aria-hidden="true"
	class="inline-block shrink-0 rounded-full border-current border-t-transparent motion-safe:animate-spin {SIZE[size]}"
></span>
