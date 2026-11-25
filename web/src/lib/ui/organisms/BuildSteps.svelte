<script lang="ts">
import {
	buildProgress,
	progressTone,
	stepBadge,
	stepResultView,
} from "#web/lib/activity/build-progress.ts";
import { formatDuration, formatPercent } from "#web/lib/activity/format.ts";
import type { BuildStepFullResult, BuildStepItem } from "#web/lib/contract.ts";
import Badge, { BADGE_VARIANT } from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import CodeBlock from "#web/lib/ui/atoms/CodeBlock.svelte";
import ProgressBar from "#web/lib/ui/atoms/ProgressBar.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import ErrorBlock from "#web/lib/ui/molecules/ErrorBlock.svelte";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";

// Progreso de un lote (figma_build) y sus pasos. Conoce los datos del histórico (BuildStepItem); la página
// Jobs lo refresca en vivo por el SSE. La lógica pura (progreso, mapeo de estados) está en lib/activity/build-progress.ts.
// De cada paso enseña un extracto del resultado; `loadFull` (si hay) pide el resultado entero bajo demanda.
type Props = {
	steps: readonly BuildStepItem[];
	cancelled?: boolean;
	loadFull?: ((index: number) => Promise<BuildStepFullResult | null>) | undefined;
};
let { steps, cancelled = false, loadFull }: Props = $props();

let full = $state<Record<number, BuildStepFullResult | null>>({});
let loading = $state<Record<number, boolean>>({});
let failed = $state<Record<number, boolean>>({});
async function showFull(index: number): Promise<void> {
	if (loadFull === undefined || loading[index]) return;
	loading[index] = true;
	failed[index] = false;
	try {
		full[index] = await loadFull(index);
	} catch {
		failed[index] = true;
	} finally {
		loading[index] = false;
	}
}

const progress = $derived(buildProgress(steps));
const percent = $derived(formatPercent(progress.done, progress.total));
</script>

<div class="flex min-w-0 flex-col gap-4">
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-sm font-semibold text-text-primary">Pasos del lote</span>
		{#if cancelled}<Badge variant={BADGE_VARIANT.secondary} size="sm" dot>Cancelado</Badge>{/if}
	</div>

	{#if steps.length === 0}
		<EmptyState size="sm">
			{#snippet icon()}<Icon name="queue-list" size="lg" />{/snippet}
			Sin pasos todavía
			{#snippet description()}Los pasos aparecen conforme el lote avanza.{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-2">
			<ProgressBar
				done={progress.done}
				total={progress.total}
				tone={progressTone(steps)}
				label="Progreso del lote"
			/>
			<p class="font-mono text-xs text-text-muted">
				{progress.done}/{progress.total}{percent !== null ? ` · ${percent}` : ""}{progress.current ? ` · ${progress.current.file}` : ""}
			</p>
		</div>

		<ol class="flex flex-col gap-2">
			{#each steps as step (step.index)}
				{@const badge = stepBadge(step.status)}
				{@const result = stepResultView(step, full[step.index])}
				<li class="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-mono text-xs text-text-muted">{step.index + 1}.</span>
						<span class="font-mono text-xs text-text-secondary">{step.file}</span>
						<Term term={badge.term} variant={TERM_VARIANT.bare}><Badge variant={badge.variant} size="sm" dot>{badge.text}</Badge></Term>
						{#if step.ms !== null}<span class="font-mono text-xs text-text-muted">{formatDuration(step.ms)}</span>{/if}
						{#if step.touchedCount > 0}<span class="font-mono text-xs text-text-muted">{step.touchedCount} nodos</span>{/if}
					</div>
					{#if step.error}<ErrorBlock error={step.error}>{#snippet children()}Paso{/snippet}</ErrorBlock>{/if}
					{#if step.warning}<p class="text-xs text-warning-700">{step.warning}</p>{/if}
					{#if result.kind === "excerpt"}
						<div class="flex flex-col gap-1">
							<span class="text-xs font-medium text-text-secondary">Resultado</span>
							<CodeBlock size="sm">{result.text}</CodeBlock>
							{#if result.truncated}
								<p class="text-xs text-text-muted">Recortado: el resultado entero ocupa {result.bytes} bytes.</p>
								{#if loadFull}
									<div>
										<Button size="sm" variant={BUTTON_VARIANT.secondary} loading={loading[step.index] ?? false} onclick={() => showFull(step.index)}>Ver completo</Button>
									</div>
									{#if failed[step.index]}<p role="alert" class="text-xs text-danger-700">No se pudo cargar el resultado entero.</p>{/if}
								{/if}
							{/if}
						</div>
					{:else if result.kind === "text"}
						<div class="flex flex-col gap-1">
							<span class="text-xs font-medium text-text-secondary">Resultado</span>
							<CodeBlock size="sm">{result.text}</CodeBlock>
							{#if result.hiddenChars > 0}<p class="text-xs text-text-muted">Recortado: faltan {result.hiddenChars} caracteres. El resultado entero está en el histórico (figma_history_call).</p>{/if}
						</div>
					{:else if result.kind === "file"}
						<div class="flex flex-col gap-1">
							<span class="text-xs font-medium text-text-secondary">Resultado en disco ({result.bytes} bytes)</span>
							<CodeBlock size="sm">{result.path}</CodeBlock>
						</div>
					{:else if result.kind === "none"}
						<p class="text-xs text-text-muted">{result.text}</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>
