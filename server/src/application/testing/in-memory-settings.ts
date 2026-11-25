import type { SettingsStore } from "#application/ports/settings.ts";

// Doble del almacén de ajustes: guarda en memoria. `failWith` hace que el siguiente acceso lance, para probar el fallo
export class InMemorySettings implements SettingsStore {
	#values: Record<string, string>;
	failWith: Error | null = null;

	constructor(initial: Readonly<Record<string, string>> = {}) {
		this.#values = { ...initial };
	}

	all(): Readonly<Record<string, string>> {
		if (this.failWith) throw this.failWith;
		return { ...this.#values };
	}

	set(key: string, value: string): void {
		if (this.failWith) throw this.failWith;
		this.#values[key] = value;
	}

	remove(key: string): void {
		if (this.failWith) throw this.failWith;
		delete this.#values[key];
	}

	removeMany(keys: readonly string[]): readonly string[] {
		if (this.failWith) throw this.failWith;
		const there = keys.filter((key) => key in this.#values);
		for (const key of there) delete this.#values[key];
		return there;
	}
}
