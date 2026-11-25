// Registro de proyectos (tenants) a nivel de máquina. Contrato compartido SIN imports:
// lo lee el servidor (env.ts) y el panel, y `web/` lo toca solo con `import type`.
// Vive en la base única de la máquina (adapters/sqlite); lo escribe el panel (dashboard.ts).

// Tope del id de un proyecto: el número que da la base cabe en 16 bits con signo
export const MAX_PROJECT_ID = 32_767;

// Una fila del registro = lo que el formulario del panel guarda por proyecto.
// Los campos opcionales, si faltan, caen al default de máquina al componer el tenant (MP-3).
export type RegistryEntry = {
	readonly id: string;
	readonly name: string;
	// Directorio desde el que se lanza Claude Code para este proyecto (resolución por carpeta)
	readonly projectDir: string;
	readonly fileUrl: string;
	readonly scriptsRoots?: readonly string[];
	readonly outputDir?: string;
};

// Una fila por dar de alta: el id lo asigna el registro (autoincremento), nunca quien llama
export type EntryDraft = Omit<RegistryEntry, "id">;

// El id de un proyecto es un número que da la base (1, 2, 3…) y se usa como trozo de ruta (output/<id>/…) y en
// FCC_PROJECTS, que parte por comas. Es la única regla para cualquier id que llegue de fuera: el formulario, el
// registro y el esquema. Un número sin ceros a la izquierda ni símbolos no puede salirse de la carpeta de salida
const PROJECT_ID_PATTERN = /^[1-9][0-9]{0,4}$/;

export const isProjectId = (id: string): boolean =>
	PROJECT_ID_PATTERN.test(id) && Number(id) <= MAX_PROJECT_ID;

// Por qué un id no vale, o null si vale
export function projectIdProblem(id: string): string | null {
	return isProjectId(id)
		? null
		: `el id es un número de 1 a ${MAX_PROJECT_ID} que da el panel al dar de alta el proyecto`;
}

// El id como número (la columna `project_id` de las tablas del histórico). Un id que no lo es no llega hasta aquí:
// el registro solo guarda ids numéricos, así que fallar es avisar de un bug
export function toProjectNumber(id: string): number {
	if (!isProjectId(id)) throw new Error(`«${id}» no es un id de proyecto`);
	return Number(id);
}

export type Registry = {
	readonly entries: readonly RegistryEntry[];
	// Solo al leer: lo que se ignoró (una fila inválida) y por qué. Se omite si no hay nada que avisar
	readonly problems?: readonly string[];
};

export type RegistryError = {
	readonly type: "RegistryError";
	// unreadable: no se pudo leer/escribir la base; malformed: el contenido no cumple lo esperado;
	// conflict: otro proyecto ya usa ese archivo de Figma o esa carpeta; notFound: no existe ese proyecto
	readonly reason: "unreadable" | "malformed" | "conflict" | "notFound";
	readonly message: string;
};

export const registryError = (
	reason: RegistryError["reason"],
	message: string,
): RegistryError => ({ type: "RegistryError", reason, message });
