<script lang="ts">
import { type Filters } from "#web/lib/activity/filters.ts";
import { callsUrl, sessionsUrl, summaryUrl } from "#web/lib/activity/endpoints.ts";
import { PER_PAGE_CHOICES, paginate } from "#web/lib/activity/paginate.ts";
import { toggleSort, type SortKey } from "#web/lib/activity/sort.ts";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import type { LiveStore } from "#web/lib/activity/store.svelte.ts";
import { parseView, serializeView, type View } from "#web/lib/activity/view-state.ts";
import type { CallsPage, HistorySummary, SessionItem } from "#web/lib/contract.ts";
import { replaceSearch, routeState } from "#web/lib/route.svelte.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";
import Badge, { BADGE_VARIANT } from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import ProjectIndicator from "#web/lib/ui/molecules/ProjectIndicator.svelte";
import ActivityTable from "#web/lib/ui/organisms/ActivityTable.svelte";
import FilterBar from "#web/lib/ui/organisms/FilterBar.svelte";
import KpiRow from "#web/lib/ui/organisms/KpiRow.svelte";
import TableFooter from "#web/lib/ui/organisms/TableFooter.svelte";

type Props = { store: LiveStore };
let { store }: Props = $props();

// Sesiones que se ofrecen en el filtro (la API las acota por su propio tope)
const SESSION_CHOICES = 50;

const view = $derived(parseView(routeState.search));

// Un enlace a una llamada concreta (?open=) lleva a la página donde está: se pide una sola vez al servidor
// con `locate` y, después, el usuario pagina libremente
let located = $state<string | null>(null);
const locate = $derived(view.open !== null && view.open !== located ? view.open : null);

const calls = createResource<CallsPage>(() => callsUrl(view, { locate }), () => store.tick);
const summary = createResource<{ summary: HistorySummary }>(summaryUrl, () => store.tick);
const sessions = createResource<{ items: SessionItem[] }>(() => sessionsUrl(SESSION_CHOICES), () => store.tick);

const rows = $derived(calls.data?.items ?? []);
const total = $derived(calls.data?.total ?? 0);
const window = $derived(paginate(total, calls.data?.page ?? view.page, view.perPage));
const sessionItems = $derived(sessions.data?.items ?? []);
const tools = $derived((summary.data?.summary.topTools ?? []).map((t) => t.tool));
const latestFileUrl = $derived(sessionItems[0]?.fileUrl ?? null);

const update = (patch: Partial<View>) => replaceSearch(serializeView({ ...view, ...patch }));

// El servidor ajusta la página (filtros que reducen el total, o la de una llamada localizada): la URL la sigue.
// Solo con la respuesta de la URL actual: mientras llega la nueva, `data` es la anterior y la corregiría
$effect(() => {
	if (calls.loading) return;
	const page = calls.data?.page;
	if (page === undefined) return;
	if (locate !== null) located = locate;
	if (page !== view.page) update({ page });
});

// Nombre del proyecto activo para el indicador de contexto (null = sin proyecto en el registro)
const activeProjectName = $derived(
	projectState.projects.find((p) => p.id === projectState.activeId)?.name ?? null,
);

const onfilters = (filters: Filters) => update({ filters, page: 1 });
const onsort = (key: SortKey) => update({ sort: toggleSort(view.sort, key), page: 1 });
const ontoggle = (id: string) => update({ open: view.open === id ? null : id });
</script>

<PageHeader>
	{#snippet title()}Actividad{/snippet}
	{#snippet meta()}
		<ProjectIndicator name={activeProjectName} />
		{#if store.connection === "open"}<Badge variant={BADGE_VARIANT.success} dot>En vivo</Badge>
		{:else if store.connection === "connecting"}<Badge variant={BADGE_VARIANT.warning} dot>Conectando</Badge>
		{:else}<Badge variant={BADGE_VARIANT.danger} dot>Sin conexión</Badge>{/if}
	{/snippet}
	{#snippet description()}
		{summary.data?.summary.calls ?? 0} {summary.data?.summary.calls === 1 ? "llamada" : "llamadas"} en el histórico
	{/snippet}
	{#snippet actions()}
		{#if latestFileUrl}<Button variant={BUTTON_VARIANT.primary} href={latestFileUrl} target="_blank"><Icon name="arrow-top-right-on-square" />Abrir en Figma</Button>{/if}
	{/snippet}
</PageHeader>

<KpiRow summary={summary.data?.summary ?? null} />

<FilterBar filters={view.filters} {tools} sessions={sessionItems} onchange={onfilters} />

<ActivityTable
	entries={rows}
	sort={view.sort}
	{onsort}
	expandedId={view.open}
	{ontoggle}
	highlighted={store.fresh}
	hasActivity={(summary.data?.summary.calls ?? 0) > 0}
	showSession={sessionItems.length > 1}
/>

<TableFooter
	{window}
	perPage={view.perPage}
	choices={PER_PAGE_CHOICES}
	onpage={(page) => update({ page })}
	onperpage={(perPage) => update({ perPage, page: 1 })}
/>
