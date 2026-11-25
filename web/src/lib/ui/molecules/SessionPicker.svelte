<script lang="ts">
import { sessionLabel, relativeAgo } from "#web/lib/chat/session-label.ts";
import type { ChatSessionInfo } from "#web/lib/contract.ts";
import Select from "#web/lib/ui/atoms/Select.svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// La sesión con la que se habla, con etiquetas para personas; el id y el pid quedan en el tooltip.
// Con una sola sesión no hay nada que elegir y se muestra como etiqueta
type Props = {
	sessions: readonly ChatSessionInfo[];
	value: string;
	// Para «hace 3 min»: la hora actual la pone quien lo usa, así la etiqueta no queda congelada
	now: number;
	onchange: (sessionId: string) => void;
};
let { sessions, value, now, onchange }: Props = $props();

const current = $derived(sessions.find((s) => s.sessionId === value) ?? null);
</script>

{#snippet raw(s: ChatSessionInfo)}
	<span class="font-semibold">Sesión de Claude Code.</span> Id <span class="font-mono">{s.sessionId}</span>{s.pid !== null ? ` · pid ${s.pid}` : ""}
{/snippet}

{#if current !== null}
	<div class="flex min-w-0 items-center gap-2">
		<Tooltip placement="bottom">
			{#snippet children(trigger)}
				{#if sessions.length > 1}
					<div {...trigger}>
						<Select size="sm" {value} name="sesion" aria-label="Sesión de Claude Code" onchange={(e) => onchange(e.currentTarget.value)}>
							{#each sessions as s (s.sessionId)}<option value={s.sessionId}>{sessionLabel(s)}</option>{/each}
						</Select>
					</div>
				{:else}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex: el disparador de un tooltip debe poder enfocarse con teclado -->
					<span tabindex="0" class="inline-flex cursor-help items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary" {...trigger}>
						<span class="size-1.5 rounded-full bg-success-500" aria-hidden="true"></span>{sessionLabel(current)}
					</span>
				{/if}
			{/snippet}
			{#snippet content()}{@render raw(current)}{/snippet}
		</Tooltip>
		<span class="hidden items-center gap-1 text-xs text-text-muted sm:inline-flex"><Icon name="clock" size="xs" />arrancó {relativeAgo(current.startedAt, now)}</span>
	</div>
{/if}
