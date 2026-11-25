import type { ActivityEvent } from "#web/lib/contract.ts";

// Cuánto se resalta una fila que llega en vivo
export const HIGHLIGHT_MS = 2500;
// Tiempo que se espera a que se calme una ráfaga de eventos antes de volver a pedir datos a la API
export const REFRESH_DEBOUNCE_MS = 150;

// Solo el inicio de una llamada trae una fila nueva que resaltar; el resto de eventos solo actualiza las que ya hay
export const freshCallId = (event: ActivityEvent): string | null =>
	event.type === "tool_called" ? event.callId : null;

// Tope que se espera, como mucho, desde el primer evento pendiente: un goteo continuo de eventos no puede aplazar
// el refresco para siempre (con solo «esperar a que se calme» una lista no se actualizaba mientras algo goteaba)
export const REFRESH_MAX_WAIT_MS = 1000;

// Junta una ráfaga de eventos en un refresco: se espera `debounceMs` desde el último, pero nunca más de `maxWaitMs`
// desde el primero
export function createRefreshScheduler(
	fire: () => void,
	debounceMs: number,
	maxWaitMs: number,
): { request(): void; cancel(): void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let firstAt = 0;
	const cancel = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	return {
		request() {
			const now = Date.now();
			if (timer === null) firstAt = now;
			else clearTimeout(timer);
			const wait = Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now));
			timer = setTimeout(() => {
				timer = null;
				fire();
			}, wait);
		},
		cancel,
	};
}
