<script lang="ts">
type Size = "md" | "lg";
type Props = { size?: Size };

let { size = "md" }: Props = $props();

const SIZE: Record<Size, string> = { md: "size-8", lg: "size-14" };
</script>

<!-- Dos arcos concéntricos y un punto sobre el vértice -->
<svg viewBox="0 0 32 32" role="img" aria-label="Figma Control Center" class="shrink-0 {SIZE[size]}">
	<rect width="32" height="32" rx="8" class="fill-brand-600" />
	<g class="fill-none stroke-on-brand" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
		<path d="M7.5 25.5V16.5a8.5 8.5 0 0 1 17 0v9" />
		<path d="M12.5 25.5v-8.5a3.5 3.5 0 0 1 7 0v8.5" />
	</g>
	<circle cx="16" cy="5.6" r="1.7" class="fill-on-brand" />
</svg>
