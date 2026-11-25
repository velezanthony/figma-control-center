import { spawn } from "node:child_process";
import type {
	ProcessSpawner,
	SpawnFailure,
} from "#application/ports/process-spawner.ts";
import { err, ok, type Result } from "#domain/result.ts";

const NOT_FOUND = "ENOENT";

// Lanza un proceso suelto: sin shell (el argv va como array, nada se interpola), desligado del panel y sin
// canales de entrada/salida. Espera solo a saber si arrancó
export class NodeProcessSpawner implements ProcessSpawner {
	spawn(
		argv: readonly string[],
		options: { readonly cwd: string },
	): Promise<Result<{ readonly pid: number }, SpawnFailure>> {
		const [command, ...args] = argv;
		if (command === undefined) {
			return Promise.resolve(
				err({ type: "Failed", message: "No hay nada que ejecutar." }),
			);
		}
		return new Promise((resolve) => {
			const child = spawn(command, args, {
				cwd: options.cwd,
				detached: true,
				stdio: "ignore",
				shell: false,
			});
			child.once("error", (e: NodeJS.ErrnoException) =>
				resolve(
					err({
						type: e.code === NOT_FOUND ? "NotFound" : "Failed",
						message: e.message,
					}),
				),
			);
			child.once("spawn", () => {
				child.unref();
				resolve(
					child.pid === undefined
						? err({ type: "Failed", message: "El sistema no dio un pid." })
						: ok({ pid: child.pid }),
				);
			});
		});
	}
}
