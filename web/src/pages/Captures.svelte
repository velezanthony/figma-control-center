<script lang="ts">
import { capturesUrl } from "#web/lib/activity/endpoints.ts";
import { PER_PAGE_CHOICES, paginate } from "#web/lib/activity/paginate.ts";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import type { LiveStore } from "#web/lib/activity/store.svelte.ts";
import { parseView, serializeView, type View } from "#web/lib/activity/view-state.ts";
import type { CaptureItem } from "#web/lib/contract.ts";
import { replaceSearch, routeState } from "#web/lib/route.svelte.ts";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import CaptureGrid from "#web/lib/ui/organisms/CaptureGrid.svelte";
import TableFooter from "#web/lib/ui/organisms/TableFooter.svelte";

type Props = { store: LiveStore };
let { store }: Props = $props();

const view = $derived(parseView(routeState.search));
const captures = createResource<{ items: CaptureItem[]; total: number; page: number }>(
	() => capturesUrl(view.page, view.perPage),
	() => store.tick,
);
const total = $derived(captures.data?.total ?? 0);
const window = $derived(paginate(total, captures.data?.page ?? view.page, view.perPage));

const update = (patch: Partial<View>) => replaceSearch(serializeView({ ...view, ...patch }));

$effect(() => {
	const page = captures.data?.page;
	if (page !== undefined && page !== view.page) update({ page });
});
</script>

<PageHeader>
	{#snippet title()}Capturas{/snippet}
	{#snippet description()}{total} {total === 1 ? "captura" : "capturas"} de nodos, la más reciente primero.{/snippet}
</PageHeader>

<CaptureGrid items={captures.data?.items ?? []} />

<TableFooter
	{window}
	perPage={view.perPage}
	choices={PER_PAGE_CHOICES}
	onpage={(page) => update({ page })}
	onperpage={(next) => update({ perPage: next, page: 1 })}
/>
