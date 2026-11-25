<script lang="ts">
import { onMount } from "svelte";
import { hrefOf, ROUTE_LABEL, ROUTE_NAME, type RouteName } from "#web/lib/route.ts";
import { readCollapsed, storeCollapsed } from "#web/lib/sidebar-state.ts";
import type { Connection } from "#web/lib/activity/store.svelte.ts";
import type { ConnectionStatus, DashboardMode } from "#web/lib/contract.ts";
import { isRouteAvailable } from "#web/lib/dashboard-mode.ts";
import type { Theme } from "#web/lib/theme.ts";
import Logo from "#web/lib/ui/atoms/Logo.svelte";
import Badge from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import StatusDot from "#web/lib/ui/atoms/StatusDot.svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import type { IconName } from "#web/lib/ui/icons/icons.ts";
import NavItem from "#web/lib/ui/molecules/NavItem.svelte";
import { isRouteBlocked, NEEDS_PROJECT_HINT } from "#web/lib/projects/gating.ts";
import { projectState, selectProject } from "#web/lib/projects/projects.svelte.ts";
import { figmaLabel } from "#web/lib/home/figma-label.ts";
import { connectionRows, connectionSummary, type Health } from "#web/lib/home/status.ts";
import ProjectSelector from "#web/lib/ui/molecules/ProjectSelector.svelte";
import ThemeToggle from "#web/lib/ui/molecules/ThemeToggle.svelte";

type Props = {
	route: RouteName;
	// Lo último que se supo de Chrome y Figma (la última llamada a figma_status)
	status: ConnectionStatus | null;
	// Para decir cuánto hace de esa llamada
	now: number;
	connection: Connection;
	theme: Theme;
	ontheme: () => void;
	// En producción no se ofrecen las pantallas de desarrollo (la galería)
	mode: DashboardMode;
	// Incrustada en un contenedor (galería): sin posición fija ni botón de menú móvil
	embedded?: boolean;
};
let { route, status, now, connection, theme, ontheme, mode, embedded = false }: Props = $props();

const LINKS: readonly { route: RouteName; label: string; icon: IconName }[] = [
	{ route: ROUTE_NAME.home, label: ROUTE_LABEL[ROUTE_NAME.home], icon: "home" },
	{ route: ROUTE_NAME.activity, label: ROUTE_LABEL[ROUTE_NAME.activity], icon: "squares-2x2" },
	{ route: ROUTE_NAME.jobs, label: ROUTE_LABEL[ROUTE_NAME.jobs], icon: "clock" },
	{ route: ROUTE_NAME.captures, label: ROUTE_LABEL[ROUTE_NAME.captures], icon: "photo" },
	{ route: ROUTE_NAME.attempts, label: ROUTE_LABEL[ROUTE_NAME.attempts], icon: "arrow-path" },
	{ route: ROUTE_NAME.chat, label: ROUTE_LABEL[ROUTE_NAME.chat], icon: "chat-bubble-left-right" },
	{ route: ROUTE_NAME.projects, label: ROUTE_LABEL[ROUTE_NAME.projects], icon: "server-stack" },
	{ route: ROUTE_NAME.settings, label: ROUTE_LABEL[ROUTE_NAME.settings], icon: "adjustments-horizontal" },
	{ route: ROUTE_NAME.components, label: ROUTE_LABEL[ROUTE_NAME.components], icon: "swatch" },
];
// Fuera de las secciones de datos: abajo, junto al pie
const HELP = { route: ROUTE_NAME.help, label: ROUTE_LABEL[ROUTE_NAME.help], icon: "question-mark-circle" } as const;
const links = $derived(LINKS.filter((link) => isRouteAvailable(link.route, mode)));
const DESKTOP_QUERY = "(min-width: 1024px)";

let collapsed = $state(false);
let mobileOpen = $state(false);
let desktop = $state(true);

onMount(() => {
	try {
		collapsed = readCollapsed(localStorage);
	} catch {
		// sin almacenamiento
	}
	const media = matchMedia(DESKTOP_QUERY);
	desktop = media.matches;
	const onchange = () => (desktop = media.matches);
	media.addEventListener("change", onchange);
	return () => media.removeEventListener("change", onchange);
});

// El modo compacto solo existe en escritorio; en móvil la barra es un panel deslizante a ancho completo
const compact = $derived(collapsed && desktop);

function toggleCollapsed() {
	collapsed = !collapsed;
	try {
		storeCollapsed(localStorage, collapsed);
	} catch {
		// sin almacenamiento
	}
}

const figma = $derived(status);
// Una línea para panel, Chrome y Figma; el detalle de cada uno, en el tooltip
const rows = $derived(connectionRows(connection, status));
const summary = $derived(connectionSummary(rows));
const DOT: Record<Health, "ok" | "warning" | "error" | "idle"> = { ok: "ok", warning: "warning", error: "error", idle: "idle" };
const VERSION = `v${__APP_VERSION__}`;
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (mobileOpen = false)} />

{#if !embedded}
<button
	type="button"
	aria-label="Abrir el menú"
	aria-expanded={mobileOpen}
	onclick={() => (mobileOpen = true)}
	class="fixed top-4 left-4 z-10 flex size-9 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-text-secondary shadow-sm lg:hidden"
>
	<Icon name="bars-3" size="md" />
</button>
{/if}

{#if mobileOpen && !embedded}
	<button type="button" tabindex="-1" aria-label="Cerrar el menú" class="fixed inset-0 z-20 bg-overlay/55 lg:hidden" onclick={() => (mobileOpen = false)}></button>
{/if}

<aside
	aria-label="Navegación principal"
	class="theme-sidebar flex flex-col border-r border-border transition-all duration-slow ease-in-out {embedded ? 'relative h-full w-64' : 'fixed inset-y-0 left-0 z-30 w-64 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0'} {embedded ? '' : mobileOpen ? 'translate-x-0' : '-translate-x-full'} {compact ? 'lg:w-20' : 'lg:w-64'}"
>
	<div class="flex h-16 shrink-0 items-center border-b border-border px-4 {compact ? 'justify-center' : 'justify-between'}">
		<div class="flex min-w-0 items-center gap-2.5 overflow-hidden">
			<Logo />
			{#if !compact}
				<div class="flex min-w-0 flex-col leading-tight">
					<span class="text-sm font-bold tracking-tight text-text-primary">Figma</span>
					<span class="text-sm font-bold tracking-tight text-text-primary">Control Center</span>
					<span class="mt-0.5 text-[10px] font-bold tracking-widest text-brand-700 uppercase">Panel</span>
				</div>
			{/if}
		</div>
		<button
			type="button"
			aria-label={collapsed ? "Expandir la barra lateral" : "Contraer la barra lateral"}
			aria-pressed={collapsed}
			onclick={toggleCollapsed}
			class="absolute top-5 -right-3 z-10 hidden size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-brand-300 bg-surface text-text-muted shadow-sm transition duration-base hover:border-brand-500 hover:bg-brand-500 hover:text-on-brand lg:flex"
		>
			<span class="transition-transform duration-base {collapsed ? 'rotate-180' : ''}"><Icon name="chevron-left" /></span>
		</button>
		<button type="button" aria-label="Cerrar el menú" onclick={() => (mobileOpen = false)} class="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken lg:hidden">
			<Icon name="x-mark" />
		</button>
	</div>

	<div class="flex shrink-0 overflow-hidden border-b border-border px-3 py-3 {compact ? 'justify-center' : 'flex-col'}">
		<ProjectSelector projects={projectState.projects} activeId={projectState.activeId} onselect={selectProject} compact={compact} />
	</div>

	<nav aria-label="Secciones" class="flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto py-4">
		{#each links as link (link.route)}
			<div onclick={() => (mobileOpen = false)} role="presentation">
				<NavItem href={hrefOf(link.route)} active={route === link.route} collapsed={compact} disabledReason={isRouteBlocked(link.route, projectState) ? NEEDS_PROJECT_HINT : undefined}>
					{#snippet icon()}<Icon name={link.icon} size="sm" />{/snippet}
					{link.label}
				</NavItem>
			</div>
		{/each}
	</nav>

	<div class="shrink-0 overflow-hidden border-t border-border py-2">
		<div onclick={() => (mobileOpen = false)} role="presentation">
			<NavItem href={hrefOf(HELP.route)} active={route === HELP.route} collapsed={compact}>
				{#snippet icon()}<Icon name={HELP.icon} size="sm" />{/snippet}
				{HELP.label}
			</NavItem>
		</div>
	</div>

	<div class="flex shrink-0 flex-col gap-2 overflow-hidden border-t border-border px-3 py-3">
		<div class="flex items-center gap-1 {compact ? 'flex-col' : 'justify-between'}">
			<Tooltip placement="top">
				{#snippet children(trigger)}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex: el disparador de un tooltip debe poder enfocarse con teclado -->
					<span tabindex="0" data-testid="connection-summary" class="flex min-w-0 cursor-help items-center rounded-sm px-1 py-1" {...trigger}>
						<StatusDot size="sm" state={DOT[summary.health]}><span class="{compact ? 'sr-only' : 'truncate text-xs'}">{summary.text}</span></StatusDot>
					</span>
				{/snippet}
				{#snippet content()}
					<span class="flex flex-col gap-0.5">
						{#each rows as row (row.id)}
							<span>{row.id === "figma" ? figmaLabel(figma, now) : row.label}{#if row.detail}<span class="font-mono"> · {row.detail}</span>{/if}</span>
						{/each}
					</span>
				{/snippet}
			</Tooltip>
			<div class="flex shrink-0 items-center {compact ? 'flex-col' : ''}">
				<ThemeToggle {theme} compact ontoggle={ontheme} />
				<Button variant={BUTTON_VARIANT.ghost} size="sm" shape="icon" href={__APP_REPOSITORY__} target="_blank" aria-label="Abrir el repositorio en GitHub (pestaña nueva)"><Icon name="github" /></Button>
			</div>
		</div>
		<div class="flex items-center gap-2 px-1 {compact ? 'justify-center' : ''}">
			<Badge size="sm"><span class="font-mono">{VERSION}</span></Badge>
			{#if !compact}<span class="truncate text-[11px] text-text-muted">Figma Control Center</span>{/if}
		</div>
	</div>
</aside>
