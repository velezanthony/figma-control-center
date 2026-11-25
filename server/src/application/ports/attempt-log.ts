import type {
	AssetRecord,
	AttemptKind,
	AttemptRole,
	AttemptStatus,
} from "#domain/attempt.ts";

// Un contenido de un intento: el papel, su ruta (vacía si no la tiene) y el texto exacto. El adaptador calcula su hash
export type AttemptContent = {
	readonly role: AttemptRole;
	readonly path: string;
	readonly content: string;
};

export type AttemptInput = {
	readonly kind: AttemptKind;
	// Lo que se intenta: la ruta del fichero relativa a su raíz de scripts, `(código)` o la clave de una pantalla
	readonly target: string;
	readonly callId: string | null;
	readonly jobId?: string | undefined;
	readonly stepIndex?: number | undefined;
	readonly startedAt: Date;
	readonly finishedAt: Date;
	readonly status: AttemptStatus;
	readonly firstError?: string | undefined;
	// `figma-kit@1` o `capture-kit@1`; el hash sale del contenido del papel `kit`
	readonly kit: string;
	readonly assets?: readonly AssetRecord[] | undefined;
	readonly scripts: readonly AttemptContent[];
};

export type RecordedAttempt = { readonly id: number; readonly n: number };

// Registra los intentos del proyecto. Escribir aquí es accesorio, como el resto del histórico:
// un fallo se avisa y devuelve null, nunca rompe la herramienta
export interface AttemptLog {
	record(input: AttemptInput): RecordedAttempt | null;
}
