<script lang="ts">
import { tick } from "svelte";
import { formatClock } from "#web/lib/activity/format.ts";
import { parseMarkdown } from "#web/lib/chat/markdown.ts";
import { createParseCache } from "#web/lib/chat/parse-cache.ts";
import { announcement as permissionAnnouncement, noticeLabel } from "#web/lib/chat/permissions.ts";
import { deliveryLabel, replyState } from "#web/lib/chat/reply-state.ts";
import { CHAT_AGENT_ROLE } from "#web/lib/chat/agent-role.ts";
import type { ChatSearch } from "#web/lib/chat/search.svelte.ts";
import { CHAT_SUGGESTIONS } from "#web/lib/chat/suggestions.ts";
import { buildTimeline, type TimelineItem, waitingNotice } from "#web/lib/chat/timeline.ts";
import type { ChatMessage, PermissionBehavior, PermissionRequest } from "#web/lib/contract.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Highlighted from "#web/lib/ui/atoms/Highlighted.svelte";
import VirtualList from "#web/lib/ui/atoms/VirtualList.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import ChatBubble from "#web/lib/ui/molecules/ChatBubble.svelte";
import ChatComposer from "#web/lib/ui/molecules/ChatComposer.svelte";
import ChatSearchBar from "#web/lib/ui/molecules/ChatSearchBar.svelte";
import Markdown from "#web/lib/ui/molecules/Markdown.svelte";
import PermissionCard from "#web/lib/ui/molecules/PermissionCard.svelte";
import PermissionNotice from "#web/lib/ui/molecules/PermissionNotice.svelte";
import ThinkingIndicator from "#web/lib/ui/molecules/ThinkingIndicator.svelte";

// La conversación entera: lista virtualizada (solo se monta lo visible más un colchón) con los mensajes y las peticiones
// de permiso intercaladas por su hora, campo fijo abajo y, sin nada que mostrar, el campo grande en el centro con
// preguntas sugeridas. Si una petición pendiente queda fuera de la vista, un aviso sobre el campo lleva a ella. Ocupa
// el alto que le da quien lo contiene (h-full)
type Props = {
	messages: readonly ChatMessage[];
	// Sin sesión viva no se puede escribir: el motivo se muestra en el campo
	disabledReason?: string | undefined;
	sending?: boolean;
	error?: string | null;
	// Archivo de Figma de la sesión, para enlazar los ids de nodo de las respuestas
	fileUrl?: string | null;
	// «Ahora» para los segundos de espera: lo avanza quien lo usa
	now: number;
	// Tope del texto (el del servidor)
	maxLength: number;
	// Hay mensajes anteriores sin cargar, y se están pidiendo
	hasMore?: boolean;
	loadingOlder?: boolean;
	onloadolder?: () => void;
	// Buscador propio (Ctrl/Cmd+F): sin él no hay búsqueda
	search?: ChatSearch;
	// Captura Ctrl/Cmd+F en toda la página (el chat ocupa la página entera); si no, solo con el foco dentro del chat
	globalFind?: boolean;
	// Peticiones de permiso de la sesión: van en la conversación, entre los mensajes, por su hora
	permissions?: readonly PermissionRequest[];
	// La petición que se está contestando y el error de la última respuesta
	permissionBusyId?: number | null;
	permissionError?: string | null;
	ondecide?: (id: number, behavior: PermissionBehavior) => void;
	// Si se da, cuando la espera se estanca se ofrece lanzar un agente desde el propio hilo
	onLaunchAgent?: (() => void) | undefined;
	launching?: boolean;
	onsend: (text: string) => Promise<boolean> | boolean;
};
let { messages, disabledReason, sending = false, error = null, fileUrl = null, now, maxLength, hasMore = false, loadingOlder = false, onloadolder, search, globalFind = false, permissions = [], permissionBusyId = null, permissionError = null, ondecide, onLaunchAgent, launching = false, onsend }: Props = $props();

// Alto supuesto de un mensaje sin montar y colchón a cada lado (en pantallas): ver lib/chat/virtual.ts
const ESTIMATED_MESSAGE_PX = 140;
const OVERSCAN_VIEWPORTS = 1;
// Interpretaciones de Markdown que se recuerdan (las de los mensajes montados caben de sobra)
const MARKDOWN_CACHE_SIZE = 300;
const markdown = createParseCache(parseMarkdown, MARKDOWN_CACHE_SIZE);

let draft = $state("");
let virtual: { scrollToBottom: () => void; scrollToKey: (key: number) => void } | undefined = $state();
let section: HTMLElement | undefined = $state();
// Mensaje al que se acaba de saltar: se resalta un momento
let flashId = $state<number | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const FLASH_MS = 2000;
// Dónde estaba el foco al abrir la búsqueda, para devolverlo al cerrar
let focusBeforeSearch: HTMLElement | null = null;

$effect(() => {
	search?.bindJumper((id) => {
		virtual?.scrollToKey(id);
		flashId = id;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashId = null), FLASH_MS);
	});
	return () => search?.bindJumper(null);
});

function openSearch() {
	if (search === undefined) return;
	focusBeforeSearch = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	search.show();
}
function closeSearch() {
	search?.close();
	focusBeforeSearch?.focus();
	focusBeforeSearch = null;
}
// Ctrl/Cmd+F abre la búsqueda propia solo aquí; fuera del chat queda la del navegador
function onwindowkeydown(event: KeyboardEvent) {
	if (search === undefined || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "f") return;
	if (!globalFind && !section?.contains(event.target as Node | null)) return;
	event.preventDefault();
	openSearch();
}
let atBottom = $state(true);
let inView = $state<readonly number[] | null>(null);

const disabled = $derived(disabledReason !== undefined);
const reply = $derived(replyState(messages, now));
const timeline = $derived(buildTimeline(messages, permissions, hasMore));
const empty = $derived(timeline.length === 0 && reply.kind === "idle");
const notice = $derived(waitingNotice(timeline, inView === null ? null : new Set(inView)));
const lastQuestionId = $derived(messages.findLast((m) => m.direction === "in")?.id);
// Lo que anuncia un lector de pantalla cuando llega una respuesta (la lista virtualizada no es una región viva)
const ANNOUNCE_CHARS = 80;
const announcement = $derived.by(() => {
	const last = messages.findLast((m) => m.direction === "out");
	return last === undefined ? "" : `Claude: ${last.body.slice(0, ANNOUNCE_CHARS)}`;
});

// «Ver» del aviso: la petición pendiente a la vista y con el foco (sin que el foco mueva el scroll que la centra)
async function viewPending(key: number) {
	virtual?.scrollToKey(key);
	await tick();
	section?.querySelector<HTMLElement>(`[data-key="${key}"] article`)?.focus({ preventScroll: true });
}

async function send(text: string) {
	if (disabled || sending) return;
	if (!(await onsend(text))) return;
	draft = "";
	// Lo que escribe el propio usuario siempre se ve, aunque hubiera subido a leer; lo que llega de fuera no lo mueve
	await tick();
	virtual?.scrollToBottom();
}
const submit = () => {
	const text = draft.trim();
	if (text !== "") void send(text);
};
</script>

{#snippet composer(size: "md" | "lg")}
	<ChatComposer bind:value={draft} {size} {disabledReason} {sending} {error} {maxLength} onsubmit={submit} />
{/snippet}

<svelte:window onkeydown={onwindowkeydown} />

<section bind:this={section} aria-label="Conversación" class="flex h-full min-h-0 flex-col">
	{#if empty}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8 sm:px-6">
			<div class="flex w-full max-w-3xl flex-col gap-6">
				<div class="flex flex-col gap-2 text-center">
					<h2 class="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">¿Qué quieres saber del trabajo en Figma?</h2>
					<p class="text-sm text-text-secondary">{CHAT_AGENT_ROLE}</p>
				</div>
				{@render composer("lg")}
				<ul class="flex flex-wrap justify-center gap-2" aria-label="Preguntas sugeridas">
					{#each CHAT_SUGGESTIONS as question (question)}
						<li><Button shape="pill" size="sm" disabled={disabled || sending} onclick={() => send(question)}>{question}</Button></li>
					{/each}
				</ul>
			</div>
		</div>
	{:else}
		<div class="relative min-h-0 flex-1">
			<VirtualList bind:this={virtual} bind:atBottom bind:inView items={timeline} keyOf={(item: TimelineItem) => item.key} label="Conversación con Claude" busy={loadingOlder} estimate={ESTIMATED_MESSAGE_PX} overscan={OVERSCAN_VIEWPORTS} onreachstart={() => hasMore && onloadolder?.()}>
				{#snippet row(item)}
					<div class="mx-auto max-w-3xl px-4 sm:px-6">
						{#if item.kind === "permission"}
							{@const request = item.request}
							<PermissionCard tool={request.toolName} description={request.description} input={request.inputPreview} status={request.status} time={formatClock(request.at)} busy={permissionBusyId === request.id} onallow={() => ondecide?.(request.id, "allow")} ondeny={() => ondecide?.(request.id, "deny")} />
						{:else if item.message.direction === "in"}
							{@const message = item.message}
							{@const showDelivery = message.status !== "delivered" || message.id === lastQuestionId}
							<div class="rounded-xl {flashId === message.id ? 'motion-safe:animate-row-flash' : ''}">
								<ChatBubble direction="in" time={formatClock(message.at)} meta={showDelivery ? deliveryLabel(message.status) : undefined} metaTone={message.status === "rejected" ? "danger" : "muted"}>{#if search?.highlight}<Highlighted text={message.body} query={search.highlight} active={search.current === message.id} />{:else}{message.body}{/if}</ChatBubble>
							</div>
						{:else}
							{@const message = item.message}
							<div class="rounded-xl {flashId === message.id ? 'motion-safe:animate-row-flash' : ''}">
								<ChatBubble direction="out" time={formatClock(message.at)}><Markdown blocks={markdown.get(message.id, message.body)} {fileUrl} highlight={search?.highlight ?? ""} active={search?.current === message.id} /></ChatBubble>
							</div>
						{/if}
					</div>
				{/snippet}
				{#snippet footer()}
					<div class="mx-auto max-w-3xl px-4 sm:px-6">
						{#if loadingOlder}<p class="sr-only">Cargando mensajes anteriores</p>{/if}
						<ThinkingIndicator state={reply} {onLaunchAgent} {launching} />
					</div>
				{/snippet}
			</VirtualList>
			<p class="sr-only" role="status" aria-live="polite">{announcement}</p>
			<p class="sr-only" role="status" aria-live="polite">{permissionAnnouncement(permissions)}</p>
			{#if search?.open}
				<div class="absolute top-3 right-4 z-10 sm:right-6">
					<ChatSearchBar query={search.query} label={search.label} hasResults={search.hasResults} onquery={(value) => (search.query = value)} onnext={search.next} onprevious={search.previous} onclose={closeSearch} />
				</div>
			{/if}
			{#if !atBottom}
				<div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
					<span class="pointer-events-auto"><Button variant={BUTTON_VARIANT.secondary} shape="pill" size="sm" onclick={() => virtual?.scrollToBottom()}><Icon name="arrow-down" size="xs" />Ir al final</Button></span>
				</div>
			{/if}
		</div>
		<div class="shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
			<div class="mx-auto flex max-w-3xl flex-col gap-3">
				<div role="status" aria-live="polite" class="flex justify-center empty:hidden">
					{#if notice !== null}
						{@const target = notice.target}
						<PermissionNotice onview={() => viewPending(target)}>{noticeLabel(notice.count)}</PermissionNotice>
					{/if}
				</div>
				{#if permissionError}<p role="alert" class="text-sm text-danger-700">{permissionError}</p>{/if}
				{@render composer("md")}
			</div>
		</div>
	{/if}
</section>
