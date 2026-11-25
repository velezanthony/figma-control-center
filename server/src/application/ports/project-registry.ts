import type {
	EntryDraft,
	Registry,
	RegistryEntry,
	RegistryError,
} from "#domain/registry.ts";
import type { Result } from "#domain/result.ts";

// El registro de proyectos. Lo lee el servidor (composición) y lo escribe el panel.
// - read: un registro vacío sale vacío (no es error); una fila inválida se ignora y se cuenta en `problems`.
// - add: el registro asigna el id (autoincremental, no se reutiliza); error `conflict` si el archivo de Figma o la
//   carpeta ya son de otro proyecto.
// - update: cambia una fila existente (`notFound` si no existe, `conflict` como en add).
// - remove: borra la fila (y su histórico); borrar la que no existe no es error.
// Cada operación es atómica: dos escritores a la vez no se pisan.
export interface ProjectRegistry {
	read(): Promise<Result<Registry, RegistryError>>;
	add(draft: EntryDraft): Promise<Result<RegistryEntry, RegistryError>>;
	update(entry: RegistryEntry): Promise<Result<void, RegistryError>>;
	remove(id: string): Promise<Result<void, RegistryError>>;
}
