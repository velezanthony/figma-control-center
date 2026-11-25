<script lang="ts">
import Icon from "#web/lib/ui/icons/Icon.svelte";

// fill: ocupa todo el ancho disponible, en proporción 16:10
type Size = "sm" | "md" | "lg" | "fill";
type Props = { src: string; alt: string; size?: Size };

let { src, alt, size = "md" }: Props = $props();

const SIZE: Record<Size, string> = {
	sm: "size-16",
	md: "size-24",
	lg: "size-40",
	fill: "aspect-[16/10] w-full",
};

let img: HTMLImageElement | undefined = $state();
let status = $state<"loading" | "loaded" | "error">("loading");

$effect.pre(() => {
	void src;
	status = "loading";
});

// Una imagen en caché puede haber cargado antes de enganchar el evento
$effect(() => {
	if (img?.complete && img.naturalWidth > 0) status = "loaded";
});
</script>

<a
	href={src}
	target="_blank"
	rel="noopener"
	aria-label={alt}
	class="relative block shrink-0 overflow-hidden rounded-md border border-border bg-surface-raised transition-colors hover:border-brand-500 {SIZE[size]}"
>
	{#if status !== "error"}
		<img
			bind:this={img}
			{src}
			{alt}
			loading="lazy"
			class="size-full object-cover"
			onload={() => (status = "loaded")}
			onerror={() => (status = "error")}
		/>
	{/if}
	{#if status === "loading"}
		<span aria-hidden="true" class="absolute inset-0 bg-surface-raised motion-safe:animate-pulse"></span>
	{/if}
	{#if status === "error"}
		<span class="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[0.6875rem] text-text-muted">
			<Icon name="photo" />
			Sin vista previa
		</span>
	{/if}
</a>
