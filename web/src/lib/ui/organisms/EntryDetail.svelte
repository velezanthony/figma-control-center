<script lang="ts">
import { projectScreenshotUrl } from "#web/lib/projects/projects.svelte.ts";
import { formatClock, formatDuration } from "#web/lib/activity/format.ts";
import { jobLabel } from "#web/lib/activity/present.ts";
import { ID_TERM } from "#web/lib/glossary/terms.ts";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";
import type { CallItem } from "#web/lib/contract.ts";
import CodeBlock from "#web/lib/ui/atoms/CodeBlock.svelte";
import Thumbnail from "#web/lib/ui/atoms/Thumbnail.svelte";
import ArgList from "#web/lib/ui/molecules/ArgList.svelte";
import DetailSection from "#web/lib/ui/molecules/DetailSection.svelte";
import ErrorBlock from "#web/lib/ui/molecules/ErrorBlock.svelte";
import NodeLinks from "#web/lib/ui/molecules/NodeLinks.svelte";
import ResultLabel from "#web/lib/ui/molecules/ResultLabel.svelte";

// Detalle de una llamada: lo que se ve al desplegar su fila
type Props = { entry: CallItem; imageUrl?: (path: string) => string };
let { entry, imageUrl = projectScreenshotUrl }: Props = $props();

const fileUrl = $derived(entry.fileUrl);

const job = $derived(jobLabel(entry));
const argList = $derived(Object.entries(entry.args));
</script>

<div class="flex flex-col gap-5">
	<p class="font-mono text-xs text-text-muted">
		{formatClock(entry.startedAt)}{entry.ms !== null ? ` · ${formatDuration(entry.ms)}` : ""} · <Term term={ID_TERM.call}>llamada {entry.callId.slice(0, 8)}</Term>
	</p>
	{#if entry.error}<ErrorBlock error={entry.error} retryable={entry.retryable}>{#snippet children()}Error{/snippet}</ErrorBlock>{/if}
	<div class="grid gap-5 lg:grid-cols-2">
		<DetailSection>
			{#snippet title()}Argumentos{/snippet}
			<ArgList items={argList} />
		</DetailSection>
		{#if entry.touchedNodeIds.length > 0}
			<DetailSection>
				{#snippet title()}Nodos tocados{/snippet}
				<NodeLinks ids={entry.touchedNodeIds} {fileUrl} />
			</DetailSection>
		{/if}
	</div>
	{#if job && entry.job}
		<DetailSection>
			{#snippet title()}<Term term={ID_TERM.job} variant={TERM_VARIANT.bare}>Job {entry.jobId?.slice(0, 8)}</Term>{/snippet}
			<div class="flex flex-wrap items-center gap-2">
				<ResultLabel tone={job.tone} term={job.term}>{#snippet children()}{job.text}{/snippet}</ResultLabel>
				{#if entry.job.ms !== null}<span class="font-mono text-xs text-text-secondary">{formatDuration(entry.job.ms)}</span>{/if}
			</div>
			{#if entry.job.error}<ErrorBlock error={entry.job.error}>{#snippet children()}Job{/snippet}</ErrorBlock>{/if}
			{#if entry.job.touchedNodeIds.length > 0}<NodeLinks ids={entry.job.touchedNodeIds} {fileUrl} />{/if}
		</DetailSection>
	{/if}
	{#if entry.resultPath}
		<DetailSection>
			{#snippet title()}Resultado en disco{/snippet}
			<CodeBlock size="sm">{entry.resultPath}</CodeBlock>
		</DetailSection>
	{/if}
	{#if entry.screenshots.length > 0}
		<DetailSection>
			{#snippet title()}Capturas{/snippet}
			<div class="flex flex-wrap gap-3">
				{#each entry.screenshots as shot (shot.path)}
					<div class="flex flex-col gap-1">
						<Thumbnail src={imageUrl(shot.path)} alt="Captura del nodo {shot.nodeId}" size="lg" />
						<span class="font-mono text-xs text-text-muted">{shot.nodeId} · {shot.width}×{shot.height}</span>
					</div>
				{/each}
			</div>
		</DetailSection>
	{/if}
</div>
