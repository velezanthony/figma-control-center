// Los ajustes guardados en la base (clave → valor como texto). Los valida quien los guarda: el almacén no sabe de reglas.
export interface SettingsStore {
	// Todos los ajustes guardados
	all(): Readonly<Record<string, string>>;
	// Guarda (o sustituye) un ajuste
	set(key: string, value: string): void;
	// Borra un ajuste guardado; sin fila de esa clave no hace nada
	remove(key: string): void;
	// Borra varios en una sola transacción y devuelve las claves que tenían fila
	removeMany(keys: readonly string[]): readonly string[];
}
