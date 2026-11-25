<script lang="ts">
import { onMount } from "svelte";
import { sessionsUrl } from "#web/lib/activity/endpoints.ts";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import type { Agent } from "#web/lib/agent/agent.svelte.ts";
import { CHAT_AGENT_ROLE } from "#web/lib/chat/agent-role.ts";
import { createChatSearch } from "#web/lib/chat/search.svelte.ts";
import { createPermissions } from "#web/lib/chat/permissions.svelte.ts";
import { createChat } from "#web/lib/chat/store.svelte.ts";
import { hasLiveSession, pickSession } from "#web/lib/chat/thread.ts";
import type { SessionItem } from "#web/lib/contract.ts";
import { replaceSearch, routeState } from "#web/lib/route.svelte.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import CloseAgentButton from "#web/lib/ui/molecules/CloseAgentButton.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import SessionPicker from "#web/lib/ui/molecules/SessionPicker.svelte";
import ChatThread from "#web/lib/ui/organisms/ChatThread.svelte";

type Props = { agent: Agent };
let { agent }: Props = $props();

const SESSION_PARAM = "session";
const CLOCK_TICK_MS = 1000;
// Mismo tope que el servidor (CHAT_LIMITS.maxChars); la web no importa constantes del servidor
const MAX_CHARS = 4000;
const SESSIONS_FOR_FILE = 50;

// Solo hay sesiones con el chat activo (token publicado y proceso vivo): las demás siguen en Actividad
const items = $derived(agent.sessions);
// La sesión elegida vive en la URL; si ya no está activa o no hay ninguna, la más reciente
const chosen = $derived(pickSession(new URLSearchParams(routeState.search).get(SESSION_PARAM), items));
const current = $derived(items.find((s) => s.sessionId === chosen) ?? null);

// Un string: cambia solo al cambiar de sesión. Con el objeto, cada sondeo de sesiones (otro objeto, mismo id) reiniciaría la conversación
const sessionId = $derived(current === null ? null : current.sessionId);
const chat = createChat(() => sessionId);
const permissions = createPermissions(() => sessionId);
const search = createChatSearch({ session: () => sessionId, messages: () => chat.messages, loadAround: chat.loadAround });

// El archivo de Figma de la sesión (para enlazar los nodos que cite Claude) sale del histórico de sesiones
const history = createResource<{ items: SessionItem[] }>(() => sessionsUrl(SESSIONS_FOR_FILE), () => items.length);
const fileUrl = $derived(history.data?.items.find((s) => s.sessionId === chosen)?.fileUrl ?? null);

// Segundos de espera y «hace X min»: un reloj que avanza cada segundo
let now = $state(Date.now());
onMount(() => {
	const timer = setInterval(() => (now = Date.now()), CLOCK_TICK_MS);
	return () => clearInterval(timer);
});

// Un mensaje nuevo puede venir de una sesión que acaba de publicar su token
$effect(() => {
	if (chat.messages.length > 0) agent.refresh();
});

const choose = (id: string) => replaceSearch(`${SESSION_PARAM}=${encodeURIComponent(id)}`);
// La sesión que acabamos de lanzar se selecciona sola en cuanto publica su token
$effect(() => {
	const id = agent.arrived;
	if (id === null) return;
	choose(id);
	agent.acknowledge();
});
const disabledReason = $derived(current === null ? "No hay ninguna sesión elegida" : undefined);
</script>

<div class="flex h-full min-h-0 flex-col">
	<header class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-3 pr-4 pl-16 sm:pr-6 lg:pl-6">
		<h1 class="text-lg font-bold tracking-tight text-text-primary">Chat</h1>
		{#if current !== null && chosen !== null}
			<SessionPicker sessions={items} value={chosen} {now} onchange={choose} />
		{/if}
		<div class="ml-auto flex items-center gap-2">
			{#if agent.closeError}<p role="alert" class="text-xs text-danger-700">{agent.closeError}</p>{/if}
			<CloseAgentButton disabled={agent.closeState.disabled} confirm={agent.closeState.confirm !== null} loading={agent.closing} onclose={agent.close}>
				{#snippet reason()}{agent.closeState.reason}{/snippet}
				{#snippet question()}{agent.closeState.confirm}{/snippet}
			</CloseAgentButton>
		</div>
	</header>

	{#if !hasLiveSession(items)}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6">
			<EmptyState>
				{#snippet icon()}<Icon name="chat-bubble-left-right" size="lg" />{/snippet}
				Ninguna sesión está escuchando
				{#snippet description()}
					{#if agent.waiting}
						Lanzando agente… acepta el aviso en la terminal que se ha abierto y la sesión aparecerá aquí sola.
					{:else}
						Lanza el agente desde aquí (abre una terminal con <span class="font-mono">make agent</span>) o arráncalo tú y aparecerá solo.
					{/if}
					<span class="mt-2 block">{CHAT_AGENT_ROLE}</span>
				{/snippet}
				{#snippet actions()}
					{#if agent.canLaunch}
						<Button variant={BUTTON_VARIANT.primary} loading={agent.launching || agent.waiting} onclick={agent.launch}>
							<Icon name="bolt" size="xs" />{agent.waiting ? "Lanzando agente…" : agent.expired ? "Reintentar" : "Lanzar agente"}
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
			{#if agent.error}<p role="alert" class="max-w-prose text-center text-sm text-danger-700">{agent.error}</p>{/if}
		</div>
	{:else}
		<div class="min-h-0 flex-1">
			<ChatThread messages={chat.messages} {disabledReason} sending={chat.sending} error={chat.error} {fileUrl} {now} maxLength={MAX_CHARS} hasMore={chat.hasMore} loadingOlder={chat.loadingOlder} onloadolder={chat.loadOlder} {search} globalFind permissions={permissions.items} permissionBusyId={permissions.busyId} permissionError={permissions.error} ondecide={permissions.decide} onLaunchAgent={agent.canLaunch ? agent.launch : undefined} launching={agent.launching || agent.waiting} onsend={chat.send} />
		</div>
	{/if}
</div>
