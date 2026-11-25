<script lang="ts">
import { formatDuration, formatPercent } from "#web/lib/activity/format.ts";
import type { HistorySummary } from "#web/lib/contract.ts";
import { METRIC_TERM, termOf } from "#web/lib/glossary/terms.ts";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import Term from "#web/lib/ui/molecules/Term.svelte";
import KpiCard from "#web/lib/ui/molecules/KpiCard.svelte";

// Las cifras las calcula la base (GET /api/history/summary); null = aún no han llegado
type Props = { summary: HistorySummary | null };
let { summary }: Props = $props();

const NO_DATA = "—";
const shortOf = (key: string) => termOf(key)?.short ?? "";
const calls = $derived(summary?.calls ?? 0);
const errors = $derived(summary?.errors ?? 0);
const mean = $derived(summary?.meanMs ?? null);
const p95 = $derived(summary?.p95Ms ?? null);
</script>

<div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
	<KpiCard value={String(calls)}>
		{#snippet title()}Llamadas{/snippet}
		{#snippet help()}{shortOf(METRIC_TERM.calls)}{/snippet}
		{#snippet icon()}<Icon name="bolt" size="md" />{/snippet}
	</KpiCard>
	<KpiCard valueTone={errors > 0 ? "danger" : "primary"} value={String(errors)}>
		{#snippet title()}Errores{/snippet}
		{#snippet help()}{shortOf(METRIC_TERM.errors)}{/snippet}
		{#snippet icon()}<Icon name="exclamation-triangle" size="md" />{/snippet}
		{#snippet description()}{formatPercent(errors, calls) ?? NO_DATA} de las llamadas{/snippet}
	</KpiCard>
	<KpiCard value={String(summary?.running ?? 0)}>
		{#snippet title()}En curso{/snippet}
		{#snippet help()}{shortOf(METRIC_TERM.running)}{/snippet}
		{#snippet icon()}<Icon name="arrow-path" size="md" />{/snippet}
		{#snippet description()}Llamadas o jobs sin terminar{/snippet}
	</KpiCard>
	<KpiCard value={mean === null ? NO_DATA : formatDuration(mean)} valueTone={mean === null ? "muted" : "primary"}>
		{#snippet title()}Duración media{/snippet}
		{#snippet icon()}<Icon name="clock" size="md" />{/snippet}
		{#snippet help()}{shortOf(METRIC_TERM.meanDuration)}{/snippet}
		{#snippet description()}<Term term={METRIC_TERM.p95}>p95</Term>: {p95 === null ? NO_DATA : formatDuration(p95)}{/snippet}
	</KpiCard>
	<KpiCard value={String(summary?.nodesTouched ?? 0)}>
		{#snippet title()}Nodos tocados{/snippet}
		{#snippet help()}{shortOf(METRIC_TERM.nodesTouched)}{/snippet}
		{#snippet icon()}<Icon name="cube" size="md" />{/snippet}
		{#snippet description()}Distintos, en llamadas y jobs{/snippet}
	</KpiCard>
</div>
