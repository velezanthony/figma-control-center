import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { History } from "#application/history.ts";
import type { makeHistoryDiff } from "#application/history-diff.ts";
import type { HistoryUsageError } from "#application/history-range.ts";
import type { makeHistoryScript } from "#application/history-script.ts";
import { type AttemptItem, describeChange } from "#domain/attempt.ts";
import type { CallItem } from "#domain/history.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	attemptsInput,
	attemptsOutputShape,
	callInput,
	callOutputShape,
	diffInput,
	diffOutputShape,
	errorsOutputShape,
	limitInput,
	nodesOutputShape,
	rangeInput,
	scriptInput,
	scriptOutputShape,
	searchInput,
	searchOutputShape,
	sessionsOutputShape,
	summaryOutputShape,
} from "./history-schemas.ts";
import { localizeDates, systemTimeZone } from "./local-time.ts";
import { reply, type ToolReply, usageError } from "./presenters.ts";

// Solo leen el histórico propio: no tocan Figma ni escriben nada
const READ_ONLY_HISTORY = {
	readOnlyHint: true,
	idempotentHint: true,
	openWorldHint: false,
} as const;

type Outcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: HistoryUsageError };

// Las fechas salen en la hora local (con su diferencia), la misma que enseña el panel
const responder =
	(timeZone: string) =>
	<T>(
		outcome: Outcome<T>,
		present: (value: T) => Record<string, unknown>,
	): ToolReply =>
		outcome.ok
			? reply(
					localizeDates({ ok: true, ...present(outcome.value) }, timeZone),
					false,
				)
			: usageError(outcome.error.message);

const pageOf = <T, R>(
	page: { items: readonly T[]; total: number; truncated: boolean },
	row: (t: T) => R,
) => ({
	items: page.items.map(row),
	total: page.total,
	truncated: page.truncated,
});

// Fila breve de una búsqueda: lo justo para decidir si pedir el detalle con figma_history_call
const brief = (c: CallItem) => ({
	callId: c.callId,
	startedAt: c.startedAt,
	tool: c.tool,
	status: c.status,
	ms: c.ms,
	summary: c.summary,
	errorType: c.error?.type ?? null,
	jobStatus: c.job?.status ?? null,
});

const identity = <T>(t: T): T => t;

// Un intento con lo que cambió respecto al anterior dicho también en una frase («intento 3: cambió step; params y kit iguales»)
const attemptRow = (a: AttemptItem) => ({
	...a,
	change:
		a.changed === null
			? `intento ${a.n}: primero de este objetivo`
			: describeChange(a.n, a.changed, [
					...new Set(a.scripts.map((s) => s.role)),
				]),
});

export function registerHistoryTools(
	server: McpServer,
	history: History,
	timeZone: string = systemTimeZone(),
	historyScript: ReturnType<typeof makeHistoryScript>,
	historyDiff: ReturnType<typeof makeHistoryDiff>,
): void {
	const respond = responder(timeZone);
	server.registerTool(
		TOOL_NAME.historySummary,
		{
			title: "Resumen del histórico",
			description:
				"Resumen de la actividad de las herramientas en un rango: llamadas, escrituras en Figma, errores, en curso, duración media y p95, jobs, nodos tocados y herramientas más usadas. Empieza siempre por aquí para «¿qué se hizo?»; pide detalle solo después, con las otras figma_history_*.",
			inputSchema: rangeInput,
			outputSchema: summaryOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		(args) => respond(history.summarize(args), (summary) => ({ summary })),
	);

	server.registerTool(
		TOOL_NAME.historyErrors,
		{
			title: "Errores del histórico",
			description:
				"Errores del rango agrupados por tipo, con cuántos hubo, el siguiente paso recomendado y hasta tres ejemplos (callId, herramienta, mensaje). Incluye los jobs que fallaron. Para ver una llamada concreta usa figma_history_call con su callId.",
			inputSchema: { ...rangeInput, ...limitInput },
			outputSchema: errorsOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		({ limit, ...range }) =>
			respond(history.errors(range, limit), (page) => pageOf(page, identity)),
	);

	server.registerTool(
		TOOL_NAME.historyNodes,
		{
			title: "Nodos tocados",
			description:
				"Nodos de Figma tocados en el rango (o en una sesión): cuántas llamadas distintas los tocaron y cuál fue la última (callId y herramienta). Lo más reciente primero.",
			inputSchema: { ...rangeInput, ...limitInput },
			outputSchema: nodesOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		({ limit, ...range }) =>
			respond(history.nodesTouched(range, limit), (page) =>
				pageOf(page, identity),
			),
	);

	server.registerTool(
		TOOL_NAME.historySessions,
		{
			title: "Sesiones del servidor",
			description:
				"Sesiones del servidor MCP (una por sesión de Claude Code) vivas dentro del rango, con sus contadores de toda la vida: llamadas, escrituras, errores y tiempo total. La más reciente primero; su sessionId sirve de filtro en las otras consultas.",
			inputSchema: { ...rangeInput, ...limitInput },
			outputSchema: sessionsOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		({ limit, ...range }) =>
			respond(history.sessions(range, limit), (page) => pageOf(page, identity)),
	);

	server.registerTool(
		TOOL_NAME.historySearch,
		{
			title: "Buscar en el histórico",
			description:
				"Busca llamadas por texto (ruta de script, herramienta, texto de un error o id de nodo). Devuelve filas breves con una frase resumen, lo más reciente primero; para el detalle de una usa figma_history_call.",
			inputSchema: searchInput,
			outputSchema: searchOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		({ query, limit, ...range }) =>
			respond(
				history.search({ query, range, ...(limit !== undefined && { limit }) }),
				(page) => pageOf(page, brief),
			),
	);

	server.registerTool(
		TOOL_NAME.historyCall,
		{
			title: "Detalle de una llamada",
			description:
				"Detalle de una llamada del histórico: argumentos, resultado, error con su siguiente paso, nodos tocados, job y capturas; en un lote, sus pasos con un EXTRACTO corto del resultado de cada uno (`excerpt`, su tamaño total y si se recortó). El resultado entero de un paso se pide con `step` (su índice): el valor si cupo en el tope de resultados, o la ruta del fichero si no. Úsala solo cuando ya tengas un callId de otra consulta.",
			inputSchema: callInput,
			outputSchema: callOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		({ callId, step }) => {
			const found = history.call(callId);
			if (!found.ok || step === undefined) {
				return respond(found, (call) => {
					// Un lote (figma_build) tiene pasos en build_steps; una llamada normal o un job de script, no
					const steps = call.jobId !== null ? history.steps(call.jobId) : [];
					const attempts = history.attemptsOfCall(call.callId);
					return {
						call,
						...(steps.length > 0 && { steps }),
						...(attempts.length > 0 && { attempts }),
					};
				});
			}
			if (found.value.jobId === null) {
				return usageError(
					`La llamada ${callId} no es un lote (figma_build): no tiene pasos de los que pedir el resultado.`,
				);
			}
			return respond(
				history.stepResult(found.value.jobId, step),
				(stepResult) => ({
					call: found.value,
					stepResult,
				}),
			);
		},
	);

	server.registerTool(
		TOOL_NAME.historyAttempts,
		{
			title: "Intentos de un script o una pantalla",
			description:
				"El historial de intentos: cada vez que se ejecutó un script (figma_run_script), un paso de un lote (figma_build) o se capturó una pantalla (figma_capture) queda un intento con el contenido exacto que usó. Sin `target` devuelve los objetivos (la ruta del script relativa a su raíz de scripts, `(código)` para un `code` suelto, o la clave de la pantalla) con su número de intentos, el estado y la fecha del último; con `target` (un texto que contiene la ruta o la clave), los intentos de esos objetivos en orden, con su estado, el primer error, la llamada (`callId`, `jobId`, `stepIndex`), el kit y QUÉ PAPELES CAMBIARON respecto al anterior (step, params, kit, hooks, screens). Para ver las líneas, pide los dos contenidos con figma_history_script y compáralos. Empieza sin `target` para ver qué se ha intentado.",
			inputSchema: attemptsInput,
			outputSchema: attemptsOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		({ target, ...filters }) => {
			const clean = {
				...(filters.kind !== undefined && { kind: filters.kind }),
				...(filters.since !== undefined && { since: filters.since }),
				...(filters.limit !== undefined && { limit: filters.limit }),
			};
			return target === undefined
				? respond(history.attemptTargets(clean), (page) => ({
						mode: "targets",
						...pageOf(page, identity),
					}))
				: respond(history.attempts({ target, ...clean }), (page) => ({
						mode: "attempts",
						...pageOf(page, attemptRow),
					}));
		},
	);

	server.registerTool(
		TOOL_NAME.historyScript,
		{
			title: "Contenido exacto de un intento",
			description:
				"Escribe en `history-scripts/<sha256>.<js|json>` de la carpeta de salida del proyecto el contenido exacto que usó un intento (`attempt` + `role`: el script, sus params, el kit, los ganchos o la entrada de screens@1; o un `sha256`) y devuelve su `path` y `bytes`; el contenido nunca pasa por la conversación: léelo del fichero. Un contenido que pasó de FCC_SCRIPT_MAX_BYTES solo se guardó como hash y esta herramienta lo dice. Los `id` y los `sha256` salen de figma_history_attempts.",
			inputSchema: scriptInput,
			outputSchema: scriptOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		async (args) =>
			respond(await historyScript(args), (script) => ({ ...script })),
	);

	server.registerTool(
		TOOL_NAME.historyDiff,
		{
			title: "Qué cambió entre dos intentos",
			description:
				"Compara dos intentos del MISMO objetivo (`from` y `to`, los `id` de figma_history_attempts) y dice qué cambió: el estado de cada papel (step, params, kit, hooks, screens, map, plan, recognize…) con las líneas añadidas y borradas, los assets que aparecen, desaparecen o cambian de hash y, de UN papel (`role`, o el primero que cambió), el diff unificado. El diff de la respuesta se recorta a FCC_HISTORY_DIFF_INLINE_LINES líneas (`truncated`); el entero queda en `file`, dentro de `history-diffs/` de la carpeta de salida: léelo de ahí, no lo pidas dos veces. Los papeles JSON se comparan formateados y con las claves ordenadas. Un papel de un lado que pasó de FCC_SCRIPT_MAX_BYTES solo tiene hash (`hash_only`); un diff con demasiados cambios sale `too_large`. Solo lectura: no escribe en Figma ni repite nada.",
			inputSchema: diffInput,
			outputSchema: diffOutputShape,
			annotations: READ_ONLY_HISTORY,
		},
		async (args) => respond(await historyDiff(args), (diff) => ({ ...diff })),
	);
}
