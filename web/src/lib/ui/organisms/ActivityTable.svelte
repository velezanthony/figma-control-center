<script lang="ts">
import { formatClock, formatDuration, shortId } from "#web/lib/activity/format.ts";
import { argSummary, callLabel, jobLabel } from "#web/lib/activity/present.ts";
import { ACTIVITY_COLUMNS } from "#web/lib/activity/columns.ts";
import { type SortKey, type SortState } from "#web/lib/activity/sort.ts";
import type { CallItem } from "#web/lib/contract.ts";
import { ID_TERM, termOf } from "#web/lib/glossary/terms.ts";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";
import Badge from "#web/lib/ui/atoms/Badge.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import ResultLabel from "#web/lib/ui/molecules/ResultLabel.svelte";
import DataTable from "./DataTable.svelte";
import EntryDetail from "./EntryDetail.svelte";
import Td from "./Td.svelte";

type Props = {
	entries: readonly CallItem[];
	sort: SortState;
	onsort: (key: SortKey) => void;
	expandedId: string | null;
	ontoggle: (callId: string) => void;
	highlighted: ReadonlySet<string>;
	// Sin actividad en absoluto frente a «los filtros no dejan nada»
	hasActivity: boolean;
	showSession: boolean;
};
let { entries, sort, onsort, expandedId, ontoggle, highlighted, hasActivity, showSession }: Props = $props();

const columns = $derived(showSession ? ACTIVITY_COLUMNS : ACTIVITY_COLUMNS.filter((c) => c.id !== "session"));
const nodeCount = (e: CallItem) => e.touchedNodeIds.length + (e.job?.touchedNodeIds.length ?? 0);
</script>

<DataTable
	label="Llamadas a las herramientas"
	{columns}
	rows={entries}
	rowId={(e) => e.callId}
	{sort}
	{onsort}
	{expandedId}
	{ontoggle}
	{highlighted}
>
	{#snippet cells(e)}
		{@const call = callLabel(e)}
		{@const job = jobLabel(e)}
		{@const summary = argSummary(e)}
		<Td mono muted label="Hora">{formatClock(e.startedAt)}</Td>
		<Td label="Herramienta">
			<div class="flex min-w-0 flex-col max-md:items-end">
				<span class="font-mono text-sm font-semibold text-text-primary">{#if termOf(e.tool)}<Term term={e.tool}>{e.tool}</Term>{:else}{e.tool}{/if}</span>
				{#if summary}<span class="max-w-64 truncate font-mono text-xs text-text-muted">{summary}</span>{/if}
			</div>
		</Td>
		<Td label="Resultado">
			<div class="flex flex-wrap items-center gap-1.5">
				<ResultLabel tone={call.tone} term={call.term}>{#snippet children()}{call.text}{/snippet}</ResultLabel>
				{#if job}<ResultLabel tone={job.tone} term={job.term}>{#snippet children()}{job.text}{/snippet}</ResultLabel>{/if}
			</div>
		</Td>
		<Td mono align="right" label="Duración">{e.ms === null ? "—" : formatDuration(e.ms)}</Td>
		<Td mono align="right" label="Nodos">{nodeCount(e) === 0 ? "—" : nodeCount(e)}</Td>
		{#if showSession}<Td label="Sesión"><Term term={ID_TERM.session} variant={TERM_VARIANT.bare}><Badge size="sm">{shortId(e.sessionId)}</Badge></Term></Td>{/if}
	{/snippet}
	{#snippet detail(e)}
		<EntryDetail entry={e} />
	{/snippet}
	{#snippet empty()}
		<EmptyState size="sm">
			{#snippet icon()}<Icon name={hasActivity ? "magnifying-glass" : "clock"} size="lg" />{/snippet}
			{hasActivity ? "Ninguna llamada coincide" : "Aún no hay actividad"}
			{#snippet description()}
				{hasActivity
					? "Prueba con otra búsqueda o quita algún filtro."
					: "Cuando Claude llame a una herramienta de Figma Control Center, aparecerá aquí en directo."}
			{/snippet}
		</EmptyState>
	{/snippet}
</DataTable>
