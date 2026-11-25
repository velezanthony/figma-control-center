<script lang="ts">
import { formatWhen, kindLabel, statusLabel, statusVariant, type AttemptRow } from "#web/lib/attempts/present.ts";
import { ROUTE_NAME, hrefOf } from "#web/lib/route.ts";
import Badge from "#web/lib/ui/atoms/Badge.svelte";
import { nextIndex } from "#web/lib/ui/roving.ts";

type Props = {
	items: readonly AttemptRow[];
	// Ids del intento de «antes» y del de «después» (null: sin elegir)
	a: number | null;
	b: number | null;
	onpick: (side: "a" | "b", id: number) => void;
	now?: Date;
	timeZone?: string;
};
let { items, a, b, onpick, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props = $props();

const SIDES = [
	{ side: "a", label: "Antes", chosen: "antes" },
	{ side: "b", label: "Después", chosen: "después" },
] as const;

let list: HTMLOListElement | undefined = $state();

// Flechas, Inicio y Fin pasan el foco al mismo botón (antes o después) del intento anterior o siguiente
function onkeydown(event: KeyboardEvent) {
	const target = event.target as HTMLElement;
	const side = target.dataset["side"];
	const index = Number(target.dataset["index"]);
	if (side === undefined || Number.isNaN(index)) return;
	const next = nextIndex(event.key, index, items.length, "vertical");
	if (next === null) return;
	event.preventDefault();
	list?.querySelector<HTMLElement>(`[data-side="${side}"][data-index="${next}"]`)?.focus();
}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ol bind:this={list} aria-label="Intentos del objetivo, del más antiguo al más reciente" {onkeydown} class="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface shadow-xs">
	{#each items as item, index (item.id)}
		{@const when = formatWhen(item.startedAt, now, timeZone)}
		<li class="flex flex-col gap-2 px-4 py-3 text-sm md:flex-row md:items-start md:gap-4 {item.id === b || item.id === a ? 'bg-surface-raised' : ''}">
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<div class="flex flex-wrap items-center gap-2">
					<span class="font-mono text-sm font-semibold text-text-primary">#{item.n}</span>
					<Badge variant={statusVariant(item.status)} size="sm" dot>{statusLabel(item.status)}</Badge>
					<span class="font-mono text-xs text-text-muted" title={when.title}>{when.text}</span>
					<span class="text-xs text-text-muted">{kindLabel(item.kind)}</span>
				</div>
				{#if item.firstError !== null}
					<p class="truncate font-mono text-xs text-danger-700" title={item.firstError}>{item.firstError}</p>
				{/if}
				<p class="text-xs text-text-secondary">{item.change}</p>
				<p class="flex flex-wrap items-center gap-x-3 text-xs text-text-muted">
					{#if item.callId !== null && item.callKept}
						<a class="text-brand-700 hover:underline" href={hrefOf(ROUTE_NAME.activity, `open=${encodeURIComponent(item.callId)}`)}>Ver en Actividad</a>
						{#if item.jobId !== null}<a class="text-brand-700 hover:underline" href={hrefOf(ROUTE_NAME.jobs, `open=${encodeURIComponent(item.callId)}`)}>Ver en Jobs</a>{/if}
					{:else if item.callId !== null}
						<span>La llamada ya no está en el histórico</span>
					{/if}
				</p>
			</div>
			<div class="flex shrink-0 items-center gap-1" role="group" aria-label="Comparar el intento {item.n}">
				{#each SIDES as s (s.side)}
					{@const pressed = (s.side === "a" ? a : b) === item.id}
					<button
						type="button"
						data-side={s.side}
						data-index={index}
						aria-pressed={pressed}
						aria-label="Usar el intento {item.n} como {s.chosen}"
						onclick={() => onpick(s.side, item.id)}
						class="cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors {pressed
							? 'border-brand-500 bg-brand-50 text-brand-700'
							: 'border-border text-text-secondary hover:bg-surface-raised hover:text-text-primary'}"
					>{s.label}</button>
				{/each}
			</div>
		</li>
	{/each}
</ol>
