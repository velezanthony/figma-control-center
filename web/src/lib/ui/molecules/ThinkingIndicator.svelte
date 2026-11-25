<script lang="ts">
import { elapsedLabel, type ReplyState } from "#web/lib/chat/reply-state.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// Lo que se ve entre enviar y recibir la respuesta. `idle` no pinta nada. `onLaunchAgent`: si se da, cuando la
// espera se estanca se ofrece lanzar un agente desde aquí (gestión desde la web, sin terminal)
type Props = {
	state: ReplyState;
	onLaunchAgent?: (() => void) | undefined;
	launching?: boolean;
};
let { state: reply, onLaunchAgent, launching = false }: Props = $props();

const DOT_DELAYS_MS = [0, 150, 300] as const;
</script>

{#if reply.kind !== "idle"}
	<div role="status" class="flex gap-3">
		<span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700" aria-hidden="true"><Icon name="sparkles" size="sm" /></span>
		<div class="flex min-w-0 flex-col gap-1 pt-1 text-sm">
			{#if reply.kind === "undelivered"}
				<p class="flex items-center gap-1.5 font-medium text-danger-700"><Icon name="exclamation-triangle" size="sm" />No entregado</p>
				<p class="text-text-secondary">La sesión no aceptó el mensaje. Vuelve a enviarlo; si se repite, relanza el agente.</p>
			{:else if reply.kind === "queued"}
				<p class="text-text-secondary">Enviando a la sesión…</p>
			{:else}
				<p class="flex items-center gap-2 text-text-secondary">
					<span>Claude está pensando</span>
					<span class="flex items-end gap-0.5" aria-hidden="true">
						{#each DOT_DELAYS_MS as delay (delay)}
							<span class="size-1.5 rounded-full bg-text-muted motion-safe:animate-bounce" style="animation-delay: {delay}ms"></span>
						{/each}
					</span>
					<span class="font-mono text-xs text-text-muted">{elapsedLabel(reply.elapsedSec)}</span>
				</p>
				{#if reply.stalled}
					<p class="text-xs text-text-muted">Llevas un buen rato sin respuesta. Puede que no haya ningún agente conectado al chat. Si hay una tarea larga en marcha, míralo en la terminal de la sesión.</p>
					{#if onLaunchAgent}
						<div class="mt-1"><Button variant={BUTTON_VARIANT.primary} size="sm" loading={launching} onclick={onLaunchAgent}><Icon name="bolt" size="xs" />Lanzar agente</Button></div>
					{/if}
				{:else if reply.slow}
					<p class="text-xs text-text-muted">Está tardando más de lo normal: puede estar consultando varias herramientas. Si no llega nada, mira la terminal de la sesión.</p>
				{/if}
			{/if}
		</div>
	</div>
{/if}
