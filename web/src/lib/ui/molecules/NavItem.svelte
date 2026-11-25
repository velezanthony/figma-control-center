<script lang="ts">
import type { Snippet } from "svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";

// collapsed: solo el icono, y el nombre pasa a un tooltip
// disabledReason: la pantalla no está disponible; el motivo sale como tooltip y como descripción accesible
type Props = { href: string; active?: boolean; collapsed?: boolean; disabledReason?: string | undefined; icon: Snippet; children: Snippet };

let { href, active = false, collapsed = false, disabledReason, icon, children: label }: Props = $props();

// Punto de marca con halo delante del activo
const ACTIVE = "before:absolute before:top-1/2 before:left-2 before:size-1.5 before:-translate-y-1/2 before:rounded-full before:bg-brand-500 before:shadow-glow";
</script>

{#snippet link(extra: Record<string, string>)}
	<!-- Deshabilitado: un enlace sin destino, enfocable para que el teclado también llegue al motivo -->
	<a
		href={disabledReason === undefined ? href : undefined}
		role={disabledReason === undefined ? undefined : "link"}
		aria-disabled={disabledReason === undefined ? undefined : "true"}
		tabindex={disabledReason === undefined ? undefined : 0}
		aria-current={active ? "page" : undefined}
		class="relative flex min-h-9 items-center gap-2.5 border-r-2 py-2 text-sm focus-visible:-outline-offset-2 transition duration-base {collapsed ? 'justify-center px-3' : 'pr-4 pl-5'} {disabledReason !== undefined ? 'cursor-not-allowed border-transparent font-medium text-text-muted opacity-60' : active ? `${ACTIVE} border-brand-500 bg-nav-selected font-semibold text-text-primary` : 'border-transparent font-medium text-text-secondary hover:bg-nav-hover hover:text-text-primary motion-safe:hover:translate-x-0.5'}"
		{...extra}
	>
		<span class="shrink-0 {active && disabledReason === undefined ? 'text-brand-700' : 'text-sidebar-icon'}">{@render icon()}</span>
		<span class={collapsed ? "sr-only" : "truncate"}>{@render label()}</span>
	</a>
{/snippet}

{#if disabledReason !== undefined}
	<Tooltip placement="bottom" fill>
		{#snippet children(trigger)}{@render link(trigger)}{/snippet}
		{#snippet content()}{#if collapsed}{@render label()}: {/if}{disabledReason}{/snippet}
	</Tooltip>
{:else if collapsed}
	<!-- fill: el enlace ocupa todo el ancho de la barra; el icono queda centrado y el borde, en el filo -->
	<Tooltip placement="bottom" fill>
		{#snippet children(trigger)}{@render link(trigger)}{/snippet}
		{#snippet content()}{@render label()}{/snippet}
	</Tooltip>
{:else}
	{@render link({})}
{/if}
