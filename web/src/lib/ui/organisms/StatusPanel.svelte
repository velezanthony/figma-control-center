<script lang="ts">
import type { Health, StatusRow } from "#web/lib/home/status.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import StatusDot from "#web/lib/ui/atoms/StatusDot.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import SectionCard from "#web/lib/ui/molecules/SectionCard.svelte";

// Cada pieza como una píldora con su estado y, debajo, el siguiente paso de las que fallan (una orden o una acción del panel)
type Props = {
	rows: readonly StatusRow[];
	launching?: boolean;
	// Sin él (no hay proyecto activo donde lanzar) no se ofrece lanzar el agente
	onlaunch?: (() => void) | undefined;
	// Error de un lanzamiento anterior
	launchError?: string | null;
};
let { rows, launching = false, onlaunch, launchError = null }: Props = $props();

const DOT: Record<Health, "ok" | "warning" | "error" | "idle"> = {
	ok: "ok",
	warning: "warning",
	error: "error",
	idle: "idle",
};

// Solo lo que no está bien trae su siguiente paso (o el error de un lanzamiento anterior del agente)
const pending = $derived(rows.filter((row) => row.next !== null || (row.id === "agent" && launchError !== null)));
</script>

<SectionCard padding="sm">
	{#snippet title()}Estado ahora{/snippet}
	<div class="flex flex-col gap-3">
		<ul aria-label="Estado ahora" class="flex flex-wrap gap-2">
			{#each rows as row (row.id)}
				<li class="flex min-w-0 items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-1.5">
					<StatusDot state={DOT[row.health]}><span class="font-semibold text-text-primary">{row.label}</span></StatusDot>
					{#if row.detail}<span class="truncate font-mono text-xs text-text-muted">{row.detail}</span>{/if}
				</li>
			{/each}
		</ul>
		{#if pending.length > 0}
			<ul aria-label="Qué hacer" class="flex flex-col gap-2 border-t border-border pt-3">
				{#each pending as row (row.id)}
					<li class="flex flex-col gap-1.5">
						{#if row.next}
							<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-secondary">
								<span class="flex items-center gap-1.5"><Icon name="arrow-top-right-on-square" size="xs" /><span class="font-semibold text-text-primary">{row.label}:</span> {row.next.text}</span>
								{#if row.next.command}<code class="rounded-md bg-surface-sunken px-2 py-0.5 font-mono text-xs text-text-primary">{row.next.command}</code>{/if}
								{#if row.next.action === "launch-agent" && onlaunch}
									<Button variant={BUTTON_VARIANT.tertiary} size="sm" loading={launching} onclick={onlaunch}><Icon name="bolt" size="xs" />Lanzar agente</Button>
								{/if}
							</div>
						{/if}
						{#if row.id === "agent" && launchError}<p role="alert" class="pl-4 text-sm text-danger-700">{launchError}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</SectionCard>
