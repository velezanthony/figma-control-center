import type { ActivityEvent } from "#web/lib/contract.ts";

// El servidor ya valida cada evento antes de enviarlo; aquí solo se comprueba la forma mínima
const isEventLike = (value: unknown): value is ActivityEvent =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { type?: unknown }).type === "string" &&
	typeof (value as { sessionId?: unknown }).sessionId === "string" &&
	typeof (value as { at?: unknown }).at === "string";

export function parseEvent(data: string): ActivityEvent | null {
	try {
		const parsed: unknown = JSON.parse(data);
		return isEventLike(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
