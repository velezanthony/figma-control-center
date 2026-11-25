import type {
	ProcessSpawner,
	SpawnFailure,
} from "#application/ports/process-spawner.ts";
import { err, ok, type Result } from "#domain/result.ts";

export type SpawnCall = {
	readonly argv: readonly string[];
	readonly cwd: string;
};

// Doble del lanzador de procesos: guarda lo que se le pidió y nunca abre nada
export class InMemoryProcessSpawner implements ProcessSpawner {
	readonly calls: SpawnCall[] = [];
	// El resultado de la próxima llamada; por defecto, un pid creciente
	next: Result<{ readonly pid: number }, SpawnFailure> | null = null;
	#pid = 1000;
	// Cuando se fija, spawn no termina hasta llamar a release() (para probar llamadas simultáneas)
	gate: Promise<void> | null = null;

	async spawn(
		argv: readonly string[],
		options: { readonly cwd: string },
	): Promise<Result<{ readonly pid: number }, SpawnFailure>> {
		this.calls.push({ argv, cwd: options.cwd });
		if (this.gate !== null) await this.gate;
		return this.next ?? ok({ pid: ++this.#pid });
	}

	fail(failure: SpawnFailure): void {
		this.next = err(failure);
	}
}
