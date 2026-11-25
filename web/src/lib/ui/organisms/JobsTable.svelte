<script lang="ts">
import { isBuildCall, isCancelledBuild } from "#web/lib/activity/build-progress.ts";
import { formatClock, formatDuration, shortId } from "#web/lib/activity/format.ts";
import { cancelHint } from "#web/lib/activity/cancel.ts";
import { argSummary, jobLabel } from "#web/lib/activity/present.ts";
import { JOBS_COLUMNS } from "#web/lib/activity/columns.ts";
import { ID_TERM } from "#web/lib/glossary/terms.ts";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";
import type { BuildStepFullResult, BuildStepItem, CallItem, CancelState } from "#web/lib/contract.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import ResultLabel from "#web/lib/ui/molecules/ResultLabel.svelte";
import BuildSteps from "./BuildSteps.svelte";
import DataTable from "./DataTable.svelte";
import EntryDetail from "./EntryDetail.svelte";
import Td from "./Td.svelte";

// buildSteps son los pasos del lote desplegado (solo se despliega una fila a la vez), ya refrescados en vivo por el SSE
type Props = {
	entries: readonly CallItem[];
	expandedId: string | null;
	ontoggle: (callId: string) => void;
	highlighted?: ReadonlySet<string>;
	buildSteps?: readonly BuildStepItem[];
	// Pide el resultado entero de un paso del lote desplegado (sin esta prop, los pasos solo enseñan el extracto)
	loadStepResult?: ((index: number) => Promise<BuildStepFullResult | null>) | undefined;
	// Cancelar desde el panel: el estado del job desplegado (null = aún sin saber), si hay una petición en vuelo y su error.
	// Sin esta prop, el detalle no ofrece cancelar
	cancel?: { state: CancelState | null; busy: boolean; error: string | null; onclick: () => void };
};
let { entries, expandedId, ontoggle, highlighted = new Set(), buildSteps = [], loadStepResult, cancel }: Props = $props();
const hint = $derived(cancelHint(cancel?.state ?? null));

</script>

<DataTable label="Jobs de scripts largos" columns={JOBS_COLUMNS} rows={entries} rowId={(e) => e.callId} {expandedId} {ontoggle} {highlighted}>
	{#snippet cells(e)}
		{@const job = jobLabel(e)}
		<Td mono muted label="Lanzado">{formatClock(e.startedAt)}</Td>
		<Td label="Script"><span class="font-mono text-xs text-text-secondary">{argSummary(e) ?? e.tool}</span></Td>
		<Td mono label="Job">{#if e.jobId === null}—{:else}<Term term={ID_TERM.job} variant={TERM_VARIANT.bare}>{shortId(e.jobId)}</Term>{/if}</Td>
		<Td label="Estado">{#if job}<ResultLabel tone={job.tone} term={job.term}>{#snippet children()}{job.text}{/snippet}</ResultLabel>{/if}</Td>
		<Td mono align="right" label="Duración">{e.job?.ms == null ? "—" : formatDuration(e.job.ms)}</Td>
		<Td mono align="right" label="Nodos">{e.job?.touchedNodeIds.length ? e.job.touchedNodeIds.length : "—"}</Td>
	{/snippet}
	{#snippet detail(e)}
		<div class="flex flex-col gap-5">
			<EntryDetail entry={e} />
			{#if cancel !== undefined && e.jobId !== null}
				<div class="flex flex-wrap items-center gap-3">
					<Tooltip placement="top">
						{#snippet children(describedby)}
							<Button variant={BUTTON_VARIANT.danger} size="sm" loading={cancel.busy} disabled={!hint.enabled} onclick={cancel.onclick} {...describedby}>Cancelar</Button>
						{/snippet}
						{#snippet content()}{hint.text}{/snippet}
					</Tooltip>
					{#if cancel.error}<p role="alert" class="text-xs text-danger-700">{cancel.error}</p>{/if}
				</div>
			{/if}
			{#if isBuildCall(e)}<BuildSteps steps={buildSteps} cancelled={isCancelledBuild(e)} loadFull={loadStepResult} />{/if}
		</div>
	{/snippet}
	{#snippet empty()}
		<EmptyState size="sm">
			{#snippet icon()}<Icon name="queue-list" size="lg" />{/snippet}
			Todavía no hay jobs
			{#snippet description()}Un job aparece cuando un script supera el plazo blando y sigue ejecutándose.{/snippet}
		</EmptyState>
	{/snippet}
</DataTable>
