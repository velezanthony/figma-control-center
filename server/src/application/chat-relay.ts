import type { ChatInbox, SessionCredentials } from "./ports/chat.ts";

// Lo que se empuja a Claude: el cuerpo y los atributos de la etiqueta <channel>
export type ChannelPush = {
	readonly content: string;
	readonly meta: Readonly<Record<string, string>>;
};

const reasonOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

export function createChatRelay(deps: {
	readonly inbox: ChatInbox;
	readonly credentials: SessionCredentials;
	readonly push: (push: ChannelPush) => Promise<void>;
	readonly warn: (message: string) => void;
}): { deliverPending(): Promise<number> } {
	return {
		// Entrega al menos una vez: un mensaje solo se da por entregado cuando el empuje terminó bien
		async deliverPending() {
			let delivered = 0;
			for (const message of deps.inbox.pending(deps.credentials)) {
				try {
					await deps.push({
						content: message.body,
						meta: { chat_id: message.chatId },
					});
				} catch (e) {
					deps.warn(
						`chat: no se pudo entregar el mensaje ${message.id}: ${reasonOf(e)}`,
					);
					return delivered;
				}
				deps.inbox.markDelivered(deps.credentials, message.id);
				delivered++;
			}
			return delivered;
		},
	};
}
