import type { ProjectRegistry } from "#application/ports/project-registry.ts";
import { figmaFileKey } from "#domain/figma-url.ts";
import {
	type EntryDraft,
	type Registry,
	type RegistryEntry,
	type RegistryError,
	registryError,
} from "#domain/registry.ts";
import { err, ok, type Result } from "#domain/result.ts";

// Dónde cae un proyecto que no fija su carpeta (como el registro real: <salida>/<id>)
const placeFor = (id: string): string => `/salida/${id}`;

// Doble del registro de proyectos: ids autoincrementales que no se reutilizan, rutas resueltas y los mismos choques
// que los índices únicos del real. Respuestas programables por método para forzar errores en los tests.
export class InMemoryProjectRegistry implements ProjectRegistry {
	#entries: RegistryEntry[];
	#problems: readonly string[];
	#lastId: number;
	readReply: (() => Result<Registry, RegistryError>) | null = null;
	writeReply: (() => Result<never, RegistryError>) | null = null;
	readonly writes: string[] = [];

	constructor(initial: Registry = { entries: [] }) {
		this.#entries = initial.entries.map((e) => this.#resolved(e));
		this.#problems = initial.problems ?? [];
		this.#lastId = Math.max(0, ...this.#entries.map((e) => Number(e.id)));
	}

	// Lo guardado ahora mismo, sin pasar por read (para afirmar en los tests)
	current(): Registry {
		return { entries: [...this.#entries] };
	}

	async read(): Promise<Result<Registry, RegistryError>> {
		if (this.readReply) return this.readReply();
		return ok({
			entries: [...this.#entries],
			...(this.#problems.length > 0 && { problems: this.#problems }),
		});
	}

	async add(draft: EntryDraft): Promise<Result<RegistryEntry, RegistryError>> {
		this.writes.push("add");
		if (this.writeReply) return this.writeReply();
		const entry = this.#resolved({ ...draft, id: String(this.#lastId + 1) });
		const conflict = this.#conflict(entry);
		if (conflict !== null) return err(conflict);
		this.#lastId += 1;
		this.#entries.push(entry);
		return ok(entry);
	}

	async update(entry: RegistryEntry): Promise<Result<void, RegistryError>> {
		this.writes.push("update");
		if (this.writeReply) return this.writeReply();
		const at = this.#entries.findIndex((e) => e.id === entry.id);
		if (at === -1) {
			return err(
				registryError("notFound", `No existe el proyecto ${entry.id}.`),
			);
		}
		const next = this.#resolved(entry);
		const conflict = this.#conflict(next);
		if (conflict !== null) return err(conflict);
		this.#entries[at] = next;
		return ok(undefined);
	}

	async remove(id: string): Promise<Result<void, RegistryError>> {
		this.writes.push("remove");
		if (this.writeReply) return this.writeReply();
		this.#entries = this.#entries.filter((e) => e.id !== id);
		return ok(undefined);
	}

	#resolved(e: RegistryEntry): RegistryEntry {
		return {
			...e,
			outputDir: (e.outputDir ?? placeFor(e.id)).replace(/\/+$/, ""),
		};
	}

	#conflict(candidate: RegistryEntry): RegistryError | null {
		for (const other of this.#entries) {
			if (other.id === candidate.id) continue;
			const key = figmaFileKey(candidate.fileUrl);
			if (key !== null && key === figmaFileKey(other.fileUrl)) {
				return registryError(
					"conflict",
					`el archivo de Figma ya lo usa el proyecto «${other.name}»`,
				);
			}
			if (candidate.outputDir === other.outputDir) {
				return registryError(
					"conflict",
					`outputDir ya lo usa el proyecto «${other.name}»`,
				);
			}
		}
		return null;
	}
}
