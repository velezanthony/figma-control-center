import type { Result } from "#domain/result.ts";

export type SpawnFailure = {
	// NotFound: el ejecutable no existe · Failed: cualquier otro fallo al arrancarlo
	readonly type: "NotFound" | "Failed";
	readonly message: string;
};

// Arranca un proceso suelto (sin shell, sin esperar a que termine). El argv es un array: nada se interpola
export interface ProcessSpawner {
	spawn(
		argv: readonly string[],
		options: { readonly cwd: string },
	): Promise<Result<{ readonly pid: number }, SpawnFailure>>;
}
