import type { FigmaError } from "./figma-error.ts";

// Un script o un paso que termina bien sin declarar nodos: aviso, no error (los build_*.js devuelven { movedCount, warn })
export const NO_IDS_WARNING =
	"Terminó sin declarar nodos creados ni modificados: el script no devolvió createdNodeIds ni mutatedNodeIds.";

export type StoredResult = { readonly path: string; readonly bytes: number };

export type RunOutcome =
	| {
			readonly ok: true;
			readonly result: unknown;
			readonly error: null;
			readonly touchedNodeIds: readonly string[];
			readonly retryable: false;
			readonly warning?: string;
	  }
	| {
			readonly ok: false;
			readonly result: null;
			readonly error: FigmaError;
			readonly touchedNodeIds: readonly string[];
			readonly retryable: boolean;
	  };

export const succeeded = (
	result: unknown,
	touchedNodeIds: readonly string[],
	warning?: string,
): RunOutcome => ({
	ok: true,
	result,
	error: null,
	touchedNodeIds,
	retryable: false,
	...(warning !== undefined && { warning }),
});

export const failed = (error: FigmaError): RunOutcome => ({
	ok: false,
	result: null,
	error,
	touchedNodeIds: [],
	retryable: error.retryable,
});

type ScriptReturn = { createdNodeIds?: unknown; mutatedNodeIds?: unknown };

const isRecord = (value: unknown): value is ScriptReturn =>
	typeof value === "object" && value !== null;

const idsOf = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((id): id is string => typeof id === "string")
		: [];

// Convención del script: `return { createdNodeIds?, mutatedNodeIds?, ...datos }`
export const extractTouchedNodeIds = (returned: unknown): string[] => {
	if (!isRecord(returned)) return [];
	const all = [
		...idsOf(returned.createdNodeIds),
		...idsOf(returned.mutatedNodeIds),
	];
	return [...new Set(all)];
};

const isIdList = (value: unknown): boolean =>
	Array.isArray(value) && value.every((id) => typeof id === "string");

// El aviso solo cuando el script no declara nada: una lista vacía de ids es declarar «no toqué nada»
export const missingIdsWarning = (returned: unknown): string | undefined =>
	isRecord(returned) &&
	(isIdList(returned.createdNodeIds) || isIdList(returned.mutatedNodeIds))
		? undefined
		: NO_IDS_WARNING;
