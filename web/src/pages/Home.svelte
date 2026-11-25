<script lang="ts">
import { callsUrl } from "#web/lib/activity/endpoints.ts";
import { DEFAULT_FILTERS, STATUS_FILTER } from "#web/lib/activity/filters.ts";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import type { LiveStore } from "#web/lib/activity/store.svelte.ts";
import { DEFAULT_SORT } from "#web/lib/activity/sort.ts";
import type { Agent } from "#web/lib/agent/agent.svelte.ts";
import type { CallsPage, ConnectionStatus } from "#web/lib/contract.ts";
import { modeState } from "#web/lib/dashboard-mode.svelte.ts";
import { isRouteAvailable } from "#web/lib/dashboard-mode.ts";
import { SECTIONS } from "#web/lib/home/sections.ts";
import { statusRows } from "#web/lib/home/status.ts";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import LatestActivity from "#web/lib/ui/organisms/LatestActivity.svelte";
import SectionLinks from "#web/lib/ui/organisms/SectionLinks.svelte";
import StatusPanel from "#web/lib/ui/organisms/StatusPanel.svelte";

type Props = { store: LiveStore; agent: Agent; status: ConnectionStatus | null };
let { store, agent, status }: Props = $props();

// Cuántas llamadas se enseñan en «Lo último»
const LATEST = 5;
const page = { sort: DEFAULT_SORT, page: 1, perPage: LATEST } as const;

const latest = createResource<CallsPage>(() => callsUrl({ ...page, filters: DEFAULT_FILTERS }), () => store.tick);
const failed = createResource<CallsPage>(
	() => callsUrl({ ...page, filters: { ...DEFAULT_FILTERS, status: STATUS_FILTER.error } }),
	() => store.tick,
);

const rows = $derived(
	statusRows({
		connection: store.connection,
		status,
		agentActive: agent.sessions.length > 0,
		agentWaiting: agent.waiting,
	}),
);
</script>

<PageHeader>
	{#snippet title()}Inicio{/snippet}
	{#snippet description()}Claude Code trabaja en Figma a través de este proyecto; aquí ves si todo está listo y qué ha pasado.{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<StatusPanel {rows} launching={agent.launching} onlaunch={agent.canLaunch ? agent.launch : undefined} launchError={agent.error} />

	<section aria-labelledby="home-latest" class="flex flex-col gap-3">
		<h2 id="home-latest" class="text-section text-text-primary">Lo último</h2>
		<LatestActivity calls={latest.data?.items ?? []} errors={failed.data?.items ?? []} />
	</section>

	<nav aria-labelledby="home-access" class="flex flex-col gap-3">
		<h2 id="home-access" class="text-section text-text-primary">Accesos</h2>
		<SectionLinks variant="compact" sections={SECTIONS.filter((section) => isRouteAvailable(section.route, modeState.current))} />
	</nav>
</div>
