<script lang="ts">
// Un id citado en el texto (nodo de Figma o llamada): enlace si se sabe adónde lleva, texto si no
type Props = {
	href: string | null;
	label: string;
	// El id completo o la explicación: sale al pasar el ratón
	title: string;
	// Con aspecto de ficha (venía como código en línea) o solo con la tipografía de datos
	chip?: boolean;
	// Abre en otra pestaña (Figma); un enlace del panel navega en la misma
	external?: boolean;
};

let { href, label, title, chip = false, external = false }: Props = $props();

const BASE = "rounded-sm font-mono text-[0.85em]";
const CHIP = "bg-surface-sunken px-1.5 py-0.5";
</script>

{#if href !== null}
	<a
		{href}
		{title}
		target={external ? "_blank" : undefined}
		rel={external ? "noopener noreferrer" : undefined}
		class="{BASE} {chip ? CHIP : ''} text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:bg-brand-50 hover:decoration-brand-700"
	>{label}</a>
{:else}
	<span {title} class="{BASE} {chip ? CHIP : ''} text-text-secondary">{label}</span>
{/if}
