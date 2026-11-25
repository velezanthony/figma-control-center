import type {
	AttemptInput,
	AttemptLog,
	RecordedAttempt,
} from "#application/ports/attempt-log.ts";

// Doble en memoria del puerto: guarda cada intento con su número por tipo y objetivo
export class InMemoryAttemptLog implements AttemptLog {
	readonly recorded: (AttemptInput & {
		readonly id: number;
		readonly n: number;
	})[] = [];
	// Programable: un registro que falla (devuelve null, como el real)
	failing = false;

	record(input: AttemptInput): RecordedAttempt | null {
		if (this.failing) return null;
		const n =
			this.recorded.filter(
				(a) => a.kind === input.kind && a.target === input.target,
			).length + 1;
		const saved = { ...input, id: this.recorded.length + 1, n };
		this.recorded.push(saved);
		return { id: saved.id, n };
	}
}
