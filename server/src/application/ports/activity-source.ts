import type { ActivityEvent } from "#domain/activity.ts";

// Un evento con su posición en el registro: el cursor con el que el panel retoma tras una desconexión
export type StoredEvent = {
	readonly id: number;
	readonly event: ActivityEvent;
};

// De dónde lee el panel la actividad que escribieron otros procesos
export interface ActivitySource {
	// Id del último evento registrado (0 si aún no hay ninguno)
	latestId(): number;
	// Eventos con id mayor que el dado, del más antiguo al más reciente, hasta `limit`
	readAfter(id: number, limit: number): readonly StoredEvent[];
	// Avisa de los eventos que se registren a partir de ahora; devuelve la función que deja de vigilar
	follow(onEvents: (events: readonly StoredEvent[]) => void): () => void;
}
