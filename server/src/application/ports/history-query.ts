import type {
	AttemptItem,
	AttemptKind,
	AttemptOrder,
	AttemptStatus,
	AttemptSummary,
	AttemptTarget,
	ScriptLookup,
	ScriptSelector,
} from "#domain/attempt.ts";
import type {
	CallItem,
	CallsPage,
	CallsQuery,
	CaptureItem,
	ConnectionStatus,
	ErrorGroup,
	HistorySummary,
	NodeTouch,
	ResolvedRange,
	SessionItem,
	StoredBuildStep,
} from "#domain/history.ts";

// Lo que devuelve el adaptador: las filas pedidas y cuántas había en total. Quien consulta decide si se cortó
export type Rows<T> = { readonly items: readonly T[]; readonly total: number };

// Solo lectura, por diseño: este puerto no tiene ningún método que escriba (lo vigila architecture.test.ts)
export interface HistoryQuery {
	summary(range: ResolvedRange, topTools: number): HistorySummary;
	errors(range: ResolvedRange, limit: number): Rows<ErrorGroup>;
	nodes(range: ResolvedRange, limit: number): Rows<NodeTouch>;
	sessions(range: ResolvedRange, limit: number): Rows<SessionItem>;
	calls(query: CallsQuery): Omit<CallsPage, "truncated">;
	call(callId: string): CallItem | null;
	// Pasos de un lote, ordenados por índice (vacío si el job no es un lote o no tiene pasos)
	steps(jobId: string): readonly StoredBuildStep[];
	// Historial de intentos. `target` es un texto que contiene la ruta o la clave del objetivo
	// Objetivos con su número de intentos, el más intentado primero. `status` filtra por cómo acabó el ÚLTIMO intento;
	// `order` y `dir` ordenan; `offset` salta filas (la página)
	attemptTargets(query: {
		readonly target: string | null;
		readonly kind: AttemptKind | null;
		readonly sinceMs: number | null;
		readonly limit: number;
		readonly status?: AttemptStatus | null;
		readonly order?: AttemptOrder;
		readonly dir?: "asc" | "desc";
		readonly offset?: number;
	}): Rows<AttemptTarget>;
	// Los intentos de UN objetivo (igualdad, no «contiene») en orden de n; `offset` null = los últimos `limit`. El
	// primero trae lo que cambió respecto a su anterior aunque este quede fuera de la página
	targetAttempts(query: {
		readonly kind: AttemptKind;
		readonly target: string;
		readonly offset: number | null;
		readonly limit: number;
	}): Rows<AttemptItem>;
	// Un intento por su id (null si no existe en este proyecto)
	attemptById(id: number): AttemptItem | null;
	// Los últimos intentos de los objetivos que contienen `target`, en orden, con los papeles que cambiaron
	attempts(query: {
		readonly target: string;
		readonly kind: AttemptKind | null;
		readonly sinceMs: number | null;
		readonly limit: number;
	}): Rows<AttemptItem>;
	attemptsOfCall(callId: string): readonly AttemptSummary[];
	storedScript(selector: ScriptSelector): ScriptLookup;
	captures(page: number, perPage: number): Rows<CaptureItem>;
	lastStatus(): ConnectionStatus | null;
}
