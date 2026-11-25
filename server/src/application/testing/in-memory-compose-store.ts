import type {
	ComposeRead,
	ComposeStore,
} from "#application/ports/compose-store.ts";
import type { ComposeFile } from "#domain/compose.ts";

// Doble en memoria: los compose que se le ponen por clave; lo demás es `missing`. Anota cada lectura
export class InMemoryComposeStore implements ComposeStore {
	readonly composes = new Map<string, ComposeFile>();
	readonly reads: { dir: string; key: string }[] = [];
	// Respuesta programada que gana a `composes`
	reply: ((dir: string, key: string) => ComposeRead | null) | null = null;

	read(dir: string, key: string): Promise<ComposeRead> {
		this.reads.push({ dir, key });
		const forced = this.reply?.(dir, key) ?? null;
		if (forced !== null) return Promise.resolve(forced);
		const compose = this.composes.get(key);
		const path = `${dir}/${key}.json`;
		return Promise.resolve(
			compose === undefined
				? { kind: "missing", path }
				: { kind: "ok", compose, path, text: JSON.stringify(compose) },
		);
	}
}
