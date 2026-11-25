<script lang="ts">
import { formatClock } from "#web/lib/activity/format.ts";
import { argSummary, callLabel } from "#web/lib/activity/present.ts";
import type { CallItem } from "#web/lib/contract.ts";
import { hrefOf, ROUTE_NAME } from "#web/lib/route.ts";
import ResultLabel from "#web/lib/ui/molecules/ResultLabel.svelte";
import SectionCard from "#web/lib/ui/molecules/SectionCard.svelte";

// Lo último que pasó: las llamadas más recientes y los errores recientes, cada una con enlace a su detalle
type Props = { calls: readonly CallItem[]; errors: readonly CallItem[] };
let { calls, errors }: Props = $props();

const detailHref = (e: CallItem) => hrefOf(ROUTE_NAME.activity, `open=${encodeURIComponent(e.callId)}`);
</script>

{#snippet list(entries: readonly CallItem[], empty: string)}
	{#if entries.length === 0}
		<p class="px-5 py-4 text-sm text-text-muted">{empty}</p>
	{:else}
		<ul class="divide-y divide-border">
			{#each entries as e (e.callId)}
				{@const call = callLabel(e)}
				{@const summary = argSummary(e)}
				<li>
					<a href={detailHref(e)} class="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-transparent px-5 py-3 transition-colors hover:border-brand-500 hover:bg-surface-raised">
						<span class="font-mono text-xs text-text-muted">{formatClock(e.startedAt)}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-mono text-sm font-semibold text-text-primary">{e.tool}</span>
							{#if summary}<span class="block truncate font-mono text-xs text-text-muted">{summary}</span>{/if}
						</span>
						<ResultLabel tone={call.tone} term={call.term}>{#snippet children()}{call.text}{/snippet}</ResultLabel>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<div class="grid gap-4 lg:grid-cols-2">
	<SectionCard padding="none">
		{#snippet title()}Últimas llamadas{/snippet}
		{@render list(calls, "Aún no hay actividad.")}
	</SectionCard>
	<SectionCard padding="none">
		{#snippet title()}Errores recientes{/snippet}
		{@render list(errors, "Sin errores: todo ha ido bien.")}
	</SectionCard>
</div>
