import type { ChatMessage, ChatPage } from "#web/lib/contract.ts";
import { withProject } from "#web/lib/projects/endpoints.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";
import {
	chatMessagesUrl,
	chatPageUrl,
	chatStreamUrl,
	SEND_CHAT_INIT,
} from "./endpoints.ts";
import { pendingCursor } from "./reply-state.ts";
import { jumpPlan } from "./search-state.ts";
import { lastMessageId, mergeMessages, parseChatMessage } from "./thread.ts";

const PENDING_POLL_MS = 1500;
// Cuántos mensajes se piden por página: la conversación nunca se carga entera
const PAGE_SIZE = 50;
// Mensajes por petición al cargar el tramo que lleva a un resultado antiguo (el servidor lo acota)
const JUMP_CHUNK = 200;

// La conversación con una sesión: el historial se pide a la API y las respuestas llegan por SSE (reanuda solo
// con Last-Event-ID). Se rehace cuando cambia la sesión elegida. Debe crearse durante la inicialización de un componente
export function createChat(session: () => string | null) {
	let messages = $state.raw<readonly ChatMessage[]>([]);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let sending = $state(false);
	let hasMore = $state(false);
	let loadingOlder = $state(false);

	$effect(() => {
		const id = session();
		// Leer el proyecto activo aquí rehace el chat al cambiar de proyecto
		const projectId = projectState.activeId;
		messages = [];
		loaded = false;
		error = null;
		hasMore = false;
		loadingOlder = false;
		if (id === null) return;
		const controller = new AbortController();
		let source: EventSource | null = null;
		fetch(withProject(chatPageUrl(id, null, PAGE_SIZE), projectId), {
			signal: controller.signal,
		})
			.then((r) => r.json() as Promise<ChatPage>)
			.then((body) => {
				messages = mergeMessages([], body.items);
				hasMore = body.hasMore;
				loaded = true;
				source = new EventSource(
					withProject(chatStreamUrl(id, lastMessageId(messages)), projectId),
				);
				source.onmessage = (e: MessageEvent<string>) => {
					const message = parseChatMessage(e.data);
					if (message !== null) messages = mergeMessages(messages, [message]);
				};
			})
			.catch((e: unknown) => {
				if ((e as Error).name !== "AbortError") error = (e as Error).message;
			});
		return () => {
			controller.abort();
			source?.close();
		};
	});

	// El estado de entrega (pendiente → entregado) cambia en la base y el SSE solo trae mensajes nuevos: mientras
	// haya un mensaje del usuario sin recoger se vuelve a pedir desde él
	const cursor = $derived(pendingCursor(messages));
	$effect(() => {
		const id = session();
		const after = cursor;
		const projectId = projectState.activeId;
		if (id === null || after === null) return;
		const controller = new AbortController();
		const timer = setInterval(() => {
			fetch(withProject(chatMessagesUrl(id, after), projectId), {
				signal: controller.signal,
			})
				.then((r) => r.json() as Promise<{ items: ChatMessage[] }>)
				.then((body) => {
					messages = mergeMessages(messages, body.items);
				})
				.catch(() => {
					// el siguiente intento lo reintenta
				});
		}, PENDING_POLL_MS);
		return () => {
			clearInterval(timer);
			controller.abort();
		};
	});

	// Los mensajes anteriores al más antiguo que hay cargado: se llama al acercarse al principio de la lista
	async function loadOlder(): Promise<void> {
		const id = session();
		const oldest = messages[0];
		if (id === null || oldest === undefined || !hasMore || loadingOlder) return;
		loadingOlder = true;
		try {
			const response = await fetch(
				withProject(
					chatPageUrl(id, oldest.id, PAGE_SIZE),
					projectState.activeId,
				),
			);
			const body = (await response.json()) as ChatPage;
			if (session() !== id) return;
			messages = mergeMessages(messages, body.items);
			hasMore = body.hasMore;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loadingOlder = false;
		}
	}

	// Carga, sin dejar huecos, desde el mensaje `targetId` (antiguo) hasta lo que ya estaba cargado, para poder llegar a él
	async function loadAround(targetId: number): Promise<void> {
		const id = session();
		const bridge = messages[0]?.id ?? null;
		let cursor: number | null = null;
		for (;;) {
			const plan = jumpPlan({ oldestLoaded: bridge, targetId, cursor });
			if (id === null || plan === null) return;
			const response = await fetch(
				withProject(
					chatMessagesUrl(id, plan.after, JUMP_CHUNK),
					projectState.activeId,
				),
			);
			const body = (await response.json()) as { items: ChatMessage[] };
			const last = body.items.at(-1);
			if (session() !== id || last === undefined) return;
			messages = mergeMessages(messages, body.items);
			hasMore = true;
			cursor = last.id;
		}
	}

	async function send(text: string): Promise<boolean> {
		const id = session();
		if (id === null || sending) return false;
		sending = true;
		error = null;
		try {
			const response = await fetch(
				withProject("/api/chat/messages", projectState.activeId),
				SEND_CHAT_INIT(id, text),
			);
			const body = (await response.json()) as {
				ok: boolean;
				message?: ChatMessage;
				error?: { message: string };
			};
			if (!response.ok || !body.ok || body.message === undefined) {
				error = body.error?.message ?? response.statusText;
				return false;
			}
			messages = mergeMessages(messages, [body.message]);
			return true;
		} catch (e) {
			error = (e as Error).message;
			return false;
		} finally {
			sending = false;
		}
	}

	return {
		get messages() {
			return messages;
		},
		get loaded() {
			return loaded;
		},
		get error() {
			return error;
		},
		get hasMore() {
			return hasMore;
		},
		get loadingOlder() {
			return loadingOlder;
		},
		loadOlder,
		loadAround,
		get sending() {
			return sending;
		},
		send,
	};
}
