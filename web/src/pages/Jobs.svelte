<script lang="ts">
import { isBuildCall } from "#web/lib/activity/build-progress.ts";
import { CANCEL_INIT, CANCEL_PATH, cancelBody, cancelStateUrl, shownCancelState } from "#web/lib/activity/cancel.ts";
import { callsUrl, jobStepResultUrl, jobStepsUrl } from "#web/lib/activity/endpoints.ts";
import { PER_PAGE_CHOICES, paginate } from "#web/lib/activity/paginate.ts";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import type { LiveStore } from "#web/lib/activity/store.svelte.ts";
import { parseView, serializeView, type View } from "#web/lib/activity/view-state.ts";
import type { BuildStepFullResult, BuildStepItem, CallsPage, CancelState } from "#web/lib/contract.ts";
import { withProject } from "#web/lib/projects/endpoints.ts";
import { replaceSearch, routeState } from "#web/lib/route.svelte.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import ProjectIndicator from "#web/lib/ui/molecules/ProjectIndicator.svelte";
import JobsTable from "#web/lib/ui/organisms/JobsTable.svelte";
import TableFooter from "#web/lib/ui/organisms/TableFooter.svelte";

type Props = { store: LiveStore };
let { store }: Props = $props();

const view = $derived(parseView(routeState.search));
// Los jobs son las llamadas que lanzaron uno; el servidor pone los que siguen en curso arriba
const jobs = createResource<CallsPage>(() => callsUrl(view, { jobsOnly: true }), () => store.tick);
const window = $derived(paginate(jobs.data?.total ?? 0, jobs.data?.page ?? view.page, view.perPage));

// Fila desplegada: si es un lote (figma_build), pedimos sus pasos y los refrescamos en vivo con el SSE (store.tick)
const openJobId = $derived.by(() => {
	const open = jobs.data?.items.find((e) => e.callId === view.open);
	return open && isBuildCall(open) && open.jobId !== null ? open.jobId : null;
});
const steps = createResource<{ steps: readonly BuildStepItem[] }>(
	() => (openJobId === null ? null : jobStepsUrl(openJobId)),
	() => store.tick,
);

// El resultado entero de un paso se pide solo cuando el usuario lo pide (los pasos traen un extracto)
async function loadStepResult(index: number): Promise<BuildStepFullResult | null> {
	if (openJobId === null) return null;
	const response = await fetch(withProject(jobStepResultUrl(openJobId, index), projectState.activeId));
	const body = (await response.json()) as { ok?: boolean; stepResult?: { result: BuildStepFullResult | null } };
	if (!response.ok || body.ok !== true || body.stepResult === undefined) throw new Error("sin resultado");
	return body.stepResult.result;
}

// Cancelar desde el panel: el job de la fila desplegada (sea lote o script: el servidor dice por qué no se puede)
const openAnyJobId = $derived(jobs.data?.items.find((e) => e.callId === view.open)?.jobId ?? null);
let cancelBump = $state(0);
let cancelBusy = $state(false);
let cancelError = $state<string | null>(null);
const cancelResource = createResource<{ jobId: string; state: CancelState }>(
	() => (openAnyJobId === null ? null : cancelStateUrl(openAnyJobId)),
	() => store.tick + cancelBump,
);
// Una respuesta de otra fila (mientras llega la nueva) no vale
const serverCancelState = $derived(cancelResource.data?.jobId === openAnyJobId ? (cancelResource.data?.state ?? null) : null);
// Al pulsar, «ya se pidió» se enseña en el acto (optimista); el servidor lo confirma o lo desmiente al responder
let requestedJobId = $state<string | null>(null);
const cancelState = $derived(shownCancelState(serverCancelState, requestedJobId, openAnyJobId));
async function requestCancel(): Promise<void> {
	if (openAnyJobId === null || cancelBusy) return;
	cancelBusy = true;
	cancelError = null;
	const jobId = openAnyJobId;
	requestedJobId = jobId;
	try {
		const response = await fetch(withProject(CANCEL_PATH, projectState.activeId), {
			...CANCEL_INIT,
			body: cancelBody(openAnyJobId),
		});
		const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
		if (!response.ok || body?.ok === false) {
			cancelError = body?.error?.message ?? "No se pudo pedir la cancelación.";
			requestedJobId = null;
		}
	} catch (e) {
		cancelError = (e as Error).message;
		requestedJobId = null;
	} finally {
		cancelBusy = false;
		cancelBump++;
	}
}
$effect(() => {
	void openAnyJobId;
	cancelError = null;
});
// Cuando el servidor ya refleja la petición, lo optimista sobra
$effect(() => {
	if (requestedJobId !== null && serverCancelState !== null && serverCancelState !== "available") requestedJobId = null;
});

const update = (patch: Partial<View>) => replaceSearch(serializeView({ ...view, ...patch }));

$effect(() => {
	const page = jobs.data?.page;
	if (page !== undefined && page !== view.page) update({ page });
});

// Nombre del proyecto activo para el indicador de contexto (null = sin proyecto en el registro)
const activeProjectName = $derived(
	projectState.projects.find((p) => p.id === projectState.activeId)?.name ?? null,
);
</script>

<PageHeader>
	{#snippet title()}Jobs{/snippet}
	{#snippet meta()}<ProjectIndicator name={activeProjectName} />{/snippet}
	{#snippet description()}Scripts largos que siguieron ejecutándose tras el plazo blando: los que están en curso, arriba.{/snippet}
</PageHeader>

<JobsTable
	entries={jobs.data?.items ?? []}
	expandedId={view.open}
	ontoggle={(id) => update({ open: view.open === id ? null : id })}
	highlighted={store.fresh}
	buildSteps={steps.data?.steps ?? []}
	{loadStepResult}
	cancel={{ state: cancelState, busy: cancelBusy, error: cancelError, onclick: requestCancel }}
/>

<TableFooter
	{window}
	perPage={view.perPage}
	choices={PER_PAGE_CHOICES}
	onpage={(page) => update({ page })}
	onperpage={(perPage) => update({ perPage, page: 1 })}
/>
