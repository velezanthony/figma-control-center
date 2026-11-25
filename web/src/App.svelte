<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { statusUrl } from "#web/lib/activity/endpoints.ts";
import { createAgent } from "#web/lib/agent/agent.svelte.ts";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import { createLiveStore } from "#web/lib/activity/store.svelte.ts";
import type { ConnectionStatus } from "#web/lib/contract.ts";
import { loadMode, modeState } from "#web/lib/dashboard-mode.svelte.ts";
import { routeIn } from "#web/lib/dashboard-mode.ts";
import { isRouteBlocked } from "#web/lib/projects/gating.ts";
import { followPageTitle } from "#web/lib/page-title.svelte.ts";
import { loadProjects, projectState } from "#web/lib/projects/projects.svelte.ts";
import { routeState } from "#web/lib/route.svelte.ts";
import { ROUTE_NAME } from "#web/lib/route.ts";
import { themeState, toggleTheme } from "#web/lib/theme.svelte.ts";
import Sidebar from "#web/lib/ui/organisms/Sidebar.svelte";
import Activity from "#web/pages/Activity.svelte";
import Attempts from "#web/pages/Attempts.svelte";
import Captures from "#web/pages/Captures.svelte";
import Chat from "#web/pages/Chat.svelte";
import Gallery from "#web/pages/Gallery.svelte";
import Help from "#web/pages/Help.svelte";
import Home from "#web/pages/Home.svelte";
import Jobs from "#web/pages/Jobs.svelte";
import NoProject from "#web/pages/NoProject.svelte";
import Settings from "#web/pages/Settings.svelte";
import Projects from "#web/pages/Projects.svelte";

// Carga los proyectos del registro y fija el activo (todas las vistas leen ese proyecto), y el modo del panel
onMount(() => {
	void loadProjects();
	void loadMode();
});
// La pantalla que se pinta: una de desarrollo en producción cae en el inicio
const route = $derived(routeIn(routeState.current, modeState.current));
followPageTitle(() => route);
// Una sola conexión SSE por pantalla; se reabre si cambia el proyecto activo
const store = createLiveStore(() => projectState.activeId);
// Chrome y Figma según la última llamada a figma_status, que se vuelve a pedir con cada novedad
const figma = createResource<{ status: ConnectionStatus | null }>(statusUrl, () => store.tick);
const agent = createAgent(() => store.tick);
// Sin proyecto activo, las pantallas de datos enseñan el aviso en lugar de pedir datos que no existen
const blocked = $derived(isRouteBlocked(route, projectState));
const fullBleed = $derived(route === ROUTE_NAME.chat && !blocked);
// Reloj para el «hace X min» de la barra lateral; la etiqueta va por minutos
const CLOCK_TICK_MS = 30_000;
let now = $state(Date.now());
const clock = setInterval(() => (now = Date.now()), CLOCK_TICK_MS);
onDestroy(() => {
	store.close();
	clearInterval(clock);
});
</script>

<div class="flex min-h-screen">
	<Sidebar {route} status={figma.data?.status ?? null} {now} connection={store.connection} theme={themeState.current} ontheme={toggleTheme} mode={modeState.current} />
	<!-- El chat es la página entera: sin relleno ni ancho máximo, y solo la lista de mensajes hace scroll -->
	<main class="min-w-0 flex-1 {fullBleed ? 'h-dvh' : 'px-6 pt-16 pb-8 sm:px-8 lg:pt-8'}">
		<div class={fullBleed ? "h-full" : "mx-auto max-w-[1400px]"}>
			{#if blocked}
				<NoProject />
			{:else if route === ROUTE_NAME.components}
				<Gallery />
			{:else if route === ROUTE_NAME.jobs}
				<Jobs {store} />
			{:else if route === ROUTE_NAME.captures}
				<Captures {store} />
			{:else if route === ROUTE_NAME.attempts}
				<Attempts {store} />
			{:else if route === ROUTE_NAME.chat}
				<Chat {agent} />
			{:else if route === ROUTE_NAME.projects}
				<Projects />
			{:else if route === ROUTE_NAME.settings}
				<Settings />
			{:else if route === ROUTE_NAME.help}
				<Help />
			{:else if route === ROUTE_NAME.activity}
				<Activity {store} />
			{:else}
				<Home {store} {agent} status={figma.data?.status ?? null} />
			{/if}
		</div>
	</main>
</div>
