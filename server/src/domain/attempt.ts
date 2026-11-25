// Historial mínimo de intentos: tipos puros, sin imports. Un intento es una ejecución de un script;
// su objetivo es lo que se intenta (la ruta del fichero relativa a su raíz de scripts, o la clave de una pantalla).

export const ATTEMPT_KIND = Object.freeze({
	runScript: "run_script",
	buildStep: "build_step",
	capture: "capture",
} as const);

export type AttemptKind = (typeof ATTEMPT_KIND)[keyof typeof ATTEMPT_KIND];

export const ATTEMPT_STATUS = Object.freeze({
	ok: "ok",
	contractError: "contract_error",
	error: "error",
} as const);

export type AttemptStatus =
	(typeof ATTEMPT_STATUS)[keyof typeof ATTEMPT_STATUS];

// Lo que se guarda de cada intento, en el orden en que se cuenta qué cambió
export const ATTEMPT_ROLE = Object.freeze({
	step: "step",
	params: "params",
	kit: "kit",
	hooks: "hooks",
	screens: "screens",
	// Hojas de componentes: el sheets@1 de la hoja
	sheets: "sheets",
	// F4: el map@1 de la pantalla, su plan (screen@1) y el módulo de reconocimiento
	map: "map",
	plan: "plan",
	recognize: "recognize",
} as const);

export type AttemptRole = (typeof ATTEMPT_ROLE)[keyof typeof ATTEMPT_ROLE];

const ROLE_ORDER: readonly AttemptRole[] = Object.values(ATTEMPT_ROLE);

// `full`: el contenido está guardado; `too_big`: solo el hash y el tamaño (pasó de FCC_SCRIPT_MAX_BYTES)
export const SCRIPT_STORED = Object.freeze({
	full: "full",
	tooBig: "too_big",
} as const);

export type ScriptStored = (typeof SCRIPT_STORED)[keyof typeof SCRIPT_STORED];

// Objetivo de un `code` suelto, sin fichero
export const CODE_TARGET = "(código)";

// Un contenido de un intento: papel, ruta si la tiene («» si no) y el hash de su contenido
export type AttemptScriptRef = {
	readonly role: AttemptRole;
	readonly path: string;
	readonly sha256: string;
};

export type AssetRecord = {
	readonly name: string;
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
};

const refKey = (ref: AttemptScriptRef) => `${ref.role}\u0000${ref.path}`;

// Papeles que cambiaron respecto al intento anterior del mismo objetivo: el contenido o la ruta de alguno es otro, o
// aparece o desaparece. Sale en el orden fijo de los papeles y sin repetir
export function changedRoles(
	previous: readonly AttemptScriptRef[],
	current: readonly AttemptScriptRef[],
): AttemptRole[] {
	const before = new Map(previous.map((ref) => [refKey(ref), ref.sha256]));
	const after = new Map(current.map((ref) => [refKey(ref), ref.sha256]));
	const changed = new Set<AttemptRole>();
	for (const ref of current) {
		if (before.get(refKey(ref)) !== ref.sha256) changed.add(ref.role);
	}
	for (const ref of previous) {
		if (!after.has(refKey(ref))) changed.add(ref.role);
	}
	return ROLE_ORDER.filter((role) => changed.has(role));
}

const list = (roles: readonly AttemptRole[]) =>
	roles.length <= 1
		? (roles[0] ?? "")
		: `${roles.slice(0, -1).join(", ")} y ${roles[roles.length - 1]}`;

// «intento 3: cambió step; params y kit iguales». `present` son los papeles que tiene el intento
export function describeChange(
	n: number,
	changed: readonly AttemptRole[],
	present: readonly AttemptRole[],
): string {
	const same = present.filter((role) => !changed.includes(role));
	const equal = same.length === 1 ? "igual" : "iguales";
	if (changed.length === 0) {
		return `intento ${n}: sin cambios (${list(same)} ${equal})`;
	}
	const verb = changed.length === 1 ? "cambió" : "cambiaron";
	const tail = same.length === 0 ? "" : `; ${list(same)} ${equal}`;
	return `intento ${n}: ${verb} ${list(changed)}${tail}`;
}

// Qué hay dentro de cada papel: un script (o módulo de ganchos) o JSON. Decide la extensión al volcar un contenido a fichero
export const BLOB_KIND = Object.freeze({ js: "js", json: "json" } as const);

export type BlobKind = (typeof BLOB_KIND)[keyof typeof BLOB_KIND];

export const blobKindOf = (role: AttemptRole): BlobKind =>
	role === ATTEMPT_ROLE.params ||
	role === ATTEMPT_ROLE.screens ||
	role === ATTEMPT_ROLE.plan ||
	role === ATTEMPT_ROLE.map
		? BLOB_KIND.json
		: BLOB_KIND.js;

// --- lo que devuelven las consultas del historial de intentos (HistoryQuery) ---

export type AttemptSummary = {
	readonly id: number;
	readonly n: number;
	readonly kind: AttemptKind;
	readonly target: string;
	readonly status: AttemptStatus;
};

// Un objetivo con sus intentos: cuántos, y cómo y cuándo acabó el último (ISO 8601 UTC)
export type AttemptTarget = {
	readonly kind: AttemptKind;
	readonly target: string;
	readonly attempts: number;
	readonly lastStatus: AttemptStatus;
	readonly lastAt: string;
};

export type AttemptScriptItem = AttemptScriptRef & {
	readonly bytes: number;
	readonly stored: ScriptStored;
};

export type AttemptItem = AttemptSummary & {
	readonly firstError: string | null;
	readonly callId: string | null;
	readonly jobId: string | null;
	readonly stepIndex: number | null;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly kit: string;
	readonly kitSha256: string;
	readonly assets: readonly AssetRecord[];
	readonly scripts: readonly AttemptScriptItem[];
	// Papeles que cambiaron respecto al intento anterior del mismo objetivo; null en el primero
	readonly changed: readonly AttemptRole[] | null;
	// La llamada de este intento sigue en el histórico (la retención puede borrarla y dejar el intento protegido)
	readonly callKept: boolean;
};

// Orden de la lista de objetivos: por número de intentos o por la hora del último
export const ATTEMPT_ORDER = Object.freeze({
	attempts: "attempts",
	last: "last",
} as const);

export type AttemptOrder = (typeof ATTEMPT_ORDER)[keyof typeof ATTEMPT_ORDER];

// Un contenido guardado. `content` es null si pasó del tope (`too_big`): solo quedan su hash y su tamaño
export type StoredScript = {
	readonly sha256: string;
	readonly kind: BlobKind;
	readonly bytes: number;
	readonly stored: ScriptStored;
	readonly content: string | null;
};

// Qué contenido se pide: el de un papel de un intento, o directamente por su hash
export type ScriptSelector =
	| {
			readonly by: "attempt";
			readonly attemptId: number;
			readonly role: AttemptRole;
			readonly path?: string | undefined;
	  }
	| { readonly by: "sha256"; readonly sha256: string };

export type ScriptLookup =
	| { readonly kind: "found"; readonly script: StoredScript }
	| { readonly kind: "not_found" }
	// El papel tiene varios contenidos (varias rutas) y no se dijo cuál
	| { readonly kind: "needs_path"; readonly paths: readonly string[] };
