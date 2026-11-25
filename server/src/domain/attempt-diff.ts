// Lo que devuelve la comparación de dos intentos. Contrato compartido con la web: solo tipos y
// sin imports (como los demás contratos), así que el bloque de diff es un parámetro: se instancia con `DiffHunk`

// `same`: el mismo contenido; `changed`: otro contenido (aunque no cambie ninguna línea, p. ej. otro orden de claves);
// `added` y `removed`: el papel solo está en un lado; `hash_only`: un lado pasó del tope y solo guarda el hash
export const ROLE_STATE = Object.freeze({
	same: "same",
	changed: "changed",
	added: "added",
	removed: "removed",
	hashOnly: "hash_only",
} as const);

export type RoleState = (typeof ROLE_STATE)[keyof typeof ROLE_STATE];

export type RoleDiff = {
	// Los papeles que no conoce este código (p. ej. `sheets`) llegan igual: el nombre es un texto
	readonly role: string;
	readonly path: string;
	readonly state: RoleState;
	// Líneas añadidas y borradas; null si no se calcularon (`same`, `hash_only` o un diff demasiado grande)
	readonly added: number | null;
	readonly removed: number | null;
};

export const ASSET_STATE = Object.freeze({
	same: "same",
	changed: "changed",
	added: "added",
	removed: "removed",
} as const);

export type AssetState = (typeof ASSET_STATE)[keyof typeof ASSET_STATE];

export type AssetInfo = {
	readonly name: string;
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
};

export type AssetDiff = {
	readonly name: string;
	readonly state: AssetState;
	readonly from: AssetInfo | null;
	readonly to: AssetInfo | null;
};

// El diff de UN papel: los bloques, o por qué no se pudo
export type ContentDiff<Hunk> = {
	readonly role: string;
	readonly path: string;
} & (
	| {
			readonly kind: "diff";
			readonly hunks: readonly Hunk[];
			readonly added: number;
			readonly removed: number;
	  }
	| { readonly kind: "too_large" }
	| {
			readonly kind: "too_big";
			readonly fromSha256: string | null;
			readonly toSha256: string | null;
	  }
);

export type AttemptEnd = {
	readonly id: number;
	readonly n: number;
	// run_script, build_step o capture
	readonly kind: string;
	readonly target: string;
	readonly startedAt: string;
};

export type AttemptDiff<Hunk> = {
	readonly from: AttemptEnd;
	readonly to: AttemptEnd;
	readonly roles: readonly RoleDiff[];
	readonly assets: readonly AssetDiff[];
	// El del papel pedido, o el primero que cambió; null si nada cambió
	readonly diff: ContentDiff<Hunk> | null;
};
