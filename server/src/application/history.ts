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
	BuildStepFullResult,
	BuildStepItem,
	CallItem,
	CallsPage,
	CallsQuery,
	CaptureItem,
	ConnectionStatus,
	ErrorGroup,
	HistorySummary,
	NodeTouch,
	Page,
	RangeInput,
	ResolvedRange,
	SessionItem,
} from "#domain/history.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { type HistoryUsageError, resolveRange } from "./history-range.ts";
import type { HistoryQuery, Rows } from "./ports/history-query.ts";
import { excerptOf } from "./step-excerpt.ts";

export type SearchInput = {
	readonly query: string;
	readonly range?: RangeInput;
	readonly limit?: number;
};
export type StepResultOutput = {
	readonly index: number;
	readonly file: string;
	readonly status: BuildStepItem["status"];
	readonly result: BuildStepFullResult | null;
};
export type ListInput = Partial<Omit<CallsQuery, "range">> & {
	readonly range?: RangeInput;
};

// Filtros de las consultas de intentos: `target` es un texto que contiene la ruta o la clave; `since`, fecha ISO 8601
export type AttemptFilters = {
	readonly kind?: AttemptKind;
	readonly since?: string;
	// Los mismos cortes que el resto del histórico (no se combina con `since`)
	readonly preset?: "today" | "last_hour";
	readonly limit?: number;
};

export type History = {
	summarize(range?: RangeInput): Result<HistorySummary, HistoryUsageError>;
	errors(
		range?: RangeInput,
		limit?: number,
	): Result<Page<ErrorGroup>, HistoryUsageError>;
	nodesTouched(
		range?: RangeInput,
		limit?: number,
	): Result<Page<NodeTouch>, HistoryUsageError>;
	sessions(
		range?: RangeInput,
		limit?: number,
	): Result<Page<SessionItem>, HistoryUsageError>;
	search(input: SearchInput): Result<Page<CallItem>, HistoryUsageError>;
	call(callId: string): Result<CallItem, HistoryUsageError>;
	// Pasos de un lote, ordenados por índice (vacío si el job no es un lote). No falla: un job desconocido da [].
	// El resultado de cada paso viene como extracto corto; el entero se pide aparte con stepResult
	steps(jobId: string): readonly BuildStepItem[];
	// El resultado entero de UN paso (tal como se guardó: el valor si cupo en el tope de M1, o la ruta del fichero)
	stepResult(
		jobId: string,
		index: number,
	): Result<StepResultOutput, HistoryUsageError>;
	list(input: ListInput): Result<CallsPage, HistoryUsageError>;
	captures(
		page: number,
		perPage: number,
	): Page<CaptureItem> & { readonly page: number; readonly perPage: number };
	// Historial de intentos: objetivos con su número de intentos, los intentos de un objetivo con los
	// papeles que cambiaron, los de una llamada y un contenido guardado
	attemptTargets(
		input: AttemptFilters & {
			readonly target?: string;
			readonly status?: AttemptStatus;
			readonly order?: AttemptOrder;
			readonly dir?: "asc" | "desc";
			readonly offset?: number;
		},
	): Result<Page<AttemptTarget>, HistoryUsageError>;
	// Los intentos de UN objetivo exacto, en orden de n (`offset` null: los últimos)
	targetAttempts(input: {
		readonly kind: AttemptKind;
		readonly target: string;
		readonly offset: number | null;
		readonly limit: number;
	}): Page<AttemptItem>;
	attemptById(id: number): AttemptItem | null;
	attempts(
		input: AttemptFilters & { readonly target: string },
	): Result<Page<AttemptItem>, HistoryUsageError>;
	attemptsOfCall(callId: string): readonly AttemptSummary[];
	script(selector: ScriptSelector): ScriptLookup;
	// Lo último que se supo de Chrome y Figma (la última llamada a figma_status)
	status(): ConnectionStatus | null;
};

// Valores fijos del programa (el tope duro es FCC_HISTORY_MAX_ROWS)
export const HISTORY_DEFAULTS = Object.freeze({
	limit: 20,
	topTools: 10,
	perPage: 25,
	// Tope del extracto de resultado de un paso (FCC_HISTORY_STEP_EXCERPT_BYTES lo cambia)
	stepExcerptBytes: 300,
} as const);

// `since` de las consultas de intentos: sin él, todo; con él, una fecha ISO 8601
const sinceMs = (
	filters: Pick<AttemptFilters, "since" | "preset">,
	now: Date,
): Result<number | null, HistoryUsageError> => {
	if (filters.since === undefined && filters.preset === undefined) {
		return ok(null);
	}
	const range = resolveRange(
		{
			...(filters.since !== undefined && { since: filters.since }),
			...(filters.preset !== undefined && { preset: filters.preset }),
		},
		now,
	);
	return range.ok ? ok(range.value.fromMs) : range;
};

const DEFAULT_SORT = { key: "time", dir: "desc" } as const;

export function createHistory(deps: {
	readonly query: HistoryQuery;
	readonly now: () => Date;
	readonly maxRows: number;
	readonly stepExcerptBytes?: number;
}): History {
	const excerptBytes =
		deps.stepExcerptBytes ?? HISTORY_DEFAULTS.stepExcerptBytes;
	const cap = (requested: number | undefined, fallback: number): number =>
		Math.max(1, Math.min(requested ?? fallback, deps.maxRows));

	const page = <T>(rows: Rows<T>): Page<T> => ({
		items: rows.items,
		total: rows.total,
		truncated: rows.total > rows.items.length,
	});

	// Resuelve el rango y, si es válido, ejecuta la consulta
	const withRange = <T>(
		input: RangeInput | undefined,
		run: (range: ResolvedRange) => T,
	): Result<T, HistoryUsageError> => {
		const range = resolveRange(input ?? {}, deps.now());
		return range.ok ? ok(run(range.value)) : range;
	};

	return {
		summarize: (range) =>
			withRange(range, (r) => deps.query.summary(r, HISTORY_DEFAULTS.topTools)),

		errors: (range, limit) =>
			withRange(range, (r) =>
				page(deps.query.errors(r, cap(limit, HISTORY_DEFAULTS.limit))),
			),

		nodesTouched: (range, limit) =>
			withRange(range, (r) =>
				page(deps.query.nodes(r, cap(limit, HISTORY_DEFAULTS.limit))),
			),

		sessions: (range, limit) =>
			withRange(range, (r) =>
				page(deps.query.sessions(r, cap(limit, HISTORY_DEFAULTS.limit))),
			),

		search(input) {
			const text = input.query.trim();
			if (text === "") {
				return err({
					type: "EmptyQuery",
					message:
						"Indica qué buscar (ruta, herramienta, texto de error o id de nodo).",
				});
			}
			return withRange(input.range, (range) => {
				const perPage = cap(input.limit, HISTORY_DEFAULTS.limit);
				const found = deps.query.calls({
					range,
					tool: null,
					status: "all",
					search: text,
					jobsOnly: false,
					sort: DEFAULT_SORT,
					page: 1,
					perPage,
					locate: null,
				});
				return { ...page(found), page: found.page, perPage: found.perPage };
			});
		},

		call(callId) {
			const found = deps.query.call(callId);
			return found === null
				? err({
						type: "NotFound",
						message: `No hay ninguna llamada con id ${callId} en el histórico.`,
					})
				: ok(found);
		},

		steps: (jobId) =>
			deps.query.steps(jobId).map(({ result, ...rest }) => ({
				...rest,
				result:
					result === null || result.kind === "file"
						? result
						: excerptOf(result.value, excerptBytes),
			})),

		stepResult(jobId, index) {
			const steps = deps.query.steps(jobId);
			const found = steps.find((s) => s.index === index);
			if (found === undefined) {
				return err({
					type: "NotFound",
					message:
						steps.length === 0
							? `El job ${jobId} no es un lote con pasos en el histórico.`
							: `El lote ${jobId} no tiene el paso ${index}: tiene ${steps.length} pasos (0 a ${steps.length - 1}).`,
				});
			}
			return ok({
				index: found.index,
				file: found.file,
				status: found.status,
				result: found.result,
			});
		},

		list(input) {
			return withRange(input.range, (range) => {
				const requested = input.perPage ?? HISTORY_DEFAULTS.perPage;
				const perPage = cap(requested, HISTORY_DEFAULTS.perPage);
				const found = deps.query.calls({
					range,
					tool: input.tool ?? null,
					status: input.status ?? "all",
					search: input.search ?? "",
					jobsOnly: input.jobsOnly ?? false,
					sort: input.sort ?? DEFAULT_SORT,
					page: Math.max(1, input.page ?? 1),
					perPage,
					locate: input.locate ?? null,
				});
				return { ...found, truncated: requested > deps.maxRows };
			});
		},

		captures(pageNumber, perPage) {
			const size = cap(perPage, HISTORY_DEFAULTS.perPage);
			const found = deps.query.captures(pageNumber, size);
			return { ...page(found), page: pageNumber, perPage: size };
		},

		attemptTargets(input) {
			const since = sinceMs(input, deps.now());
			if (!since.ok) return since;
			return ok(
				page(
					deps.query.attemptTargets({
						target: input.target ?? null,
						kind: input.kind ?? null,
						sinceMs: since.value,
						limit: cap(input.limit, HISTORY_DEFAULTS.limit),
						...(input.status !== undefined && { status: input.status }),
						...(input.order !== undefined && { order: input.order }),
						...(input.dir !== undefined && { dir: input.dir }),
						...(input.offset !== undefined && { offset: input.offset }),
					}),
				),
			);
		},

		targetAttempts: (input) =>
			page(
				deps.query.targetAttempts({
					...input,
					limit: cap(input.limit, HISTORY_DEFAULTS.limit),
				}),
			),

		attemptById: (id) => deps.query.attemptById(id),

		attempts(input) {
			const since = sinceMs(input, deps.now());
			if (!since.ok) return since;
			return ok(
				page(
					deps.query.attempts({
						target: input.target,
						kind: input.kind ?? null,
						sinceMs: since.value,
						limit: cap(input.limit, HISTORY_DEFAULTS.limit),
					}),
				),
			);
		},

		attemptsOfCall: (callId) => deps.query.attemptsOfCall(callId),

		script: (selector) => deps.query.storedScript(selector),

		status: () => deps.query.lastStatus(),
	};
}
