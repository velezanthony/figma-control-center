import { z } from "zod";
import { ATTEMPT_ROLE } from "#domain/attempt.ts";

const RANGE_PRESETS = ["last_hour", "today"] as const;

export const rangeInput = {
	preset: z
		.enum(RANGE_PRESETS)
		.optional()
		.describe(
			"Rango predefinido: `last_hour` (la última hora) o `today` (desde medianoche, hora local). No se combina con since/until.",
		),
	since: z
		.string()
		.optional()
		.describe(
			"Inicio del rango, fecha ISO 8601 (p. ej. 2026-06-01T09:00:00Z).",
		),
	until: z.string().optional().describe("Fin del rango, fecha ISO 8601."),
	sessionId: z
		.string()
		.optional()
		.describe(
			"Limita a una sesión del servidor (id completo, de figma_history_sessions).",
		),
};

export const limitInput = {
	limit: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			"Máximo de filas a devolver (por defecto 20; hay un tope configurado). La respuesta dice el total y si se cortó.",
		),
};

export const searchInput = {
	query: z
		.string()
		.min(1)
		.describe(
			"Texto a buscar: ruta de script, herramienta, texto de un error o id de nodo (p. ej. «1:23»). Todas las palabras deben aparecer.",
		),
	...rangeInput,
	...limitInput,
};

export const callInput = {
	callId: z
		.string()
		.min(1)
		.describe("Id de la llamada (el `callId` de cualquier otra consulta)."),
	step: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe(
			"Solo en un lote (figma_build): índice del paso (0 es el primero) del que quieres el resultado ENTERO. Sin él, cada paso trae solo un extracto corto.",
		),
};

const ATTEMPT_KINDS = ["run_script", "build_step", "capture"] as const;
const ATTEMPT_STATUSES = ["ok", "contract_error", "error"] as const;
const ATTEMPT_ROLES = Object.values(ATTEMPT_ROLE);

export const attemptsInput = {
	target: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Texto que contiene la ruta del script (relativa a su raíz de scripts) o la clave de la pantalla. Con él, los intentos de esos objetivos en orden; sin él, la lista de objetivos con su número de intentos.",
		),
	kind: z
		.enum(ATTEMPT_KINDS)
		.optional()
		.describe(
			"Solo los de este tipo: `run_script` (figma_run_script), `build_step` (un paso de figma_build) o `capture` (una pantalla de figma_capture).",
		),
	since: z
		.string()
		.optional()
		.describe(
			"Solo los desde esta fecha ISO 8601 (p. ej. 2026-11-11T09:00:00Z).",
		),
	...limitInput,
};

export const scriptInput = {
	attempt: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			"El `id` de un intento (de figma_history_attempts). Va con `role`; no se combina con `sha256`.",
		),
	role: z
		.enum(ATTEMPT_ROLES)
		.optional()
		.describe(
			"Qué contenido del intento: `step` (el script), `params`, `kit` (figma-kit o capture-kit), `hooks` o `screens`.",
		),
	path: z
		.string()
		.optional()
		.describe(
			"Solo si el papel tiene varios contenidos (varias rutas): cuál de ellos.",
		),
	sha256: z
		.string()
		.optional()
		.describe(
			"En vez de `attempt` y `role`: el hash (64 hexadecimales) de un contenido, tal como lo da figma_history_attempts.",
		),
};

const iso = z
	.string()
	.describe("Fecha ISO 8601 en la hora local, con su diferencia (+01:00).");

const errorSchema = z
	.object({
		type: z.string(),
		message: z.string(),
		nextStep: z.string().nullable(),
		line: z.number().nullable(),
	})
	.nullable();

const pageShape = <T extends z.ZodType>(item: T) => ({
	ok: z.boolean(),
	items: z.array(item),
	total: z.number().describe("Cuántas hay en total con ese rango."),
	truncated: z
		.boolean()
		.describe(
			"Verdadero si hay más de las devueltas: acota el rango o sube `limit`.",
		),
});

export const summaryOutputShape = {
	ok: z.boolean(),
	summary: z.object({
		range: z.object({
			fromMs: z.number().nullable(),
			toMs: z.number().nullable(),
			sessionId: z.string().nullable(),
		}),
		calls: z.number(),
		writes: z
			.number()
			.describe(
				"Llamadas que ejecutaron algo en la pestaña de Figma (bien, o con fallo del script o de plazo); no cuenta las que fallaron antes de tocarla ni figma_cancel_job.",
			),
		errors: z
			.number()
			.describe("Llamadas con error, también por un job fallido."),
		running: z.number(),
		meanMs: z.number().nullable(),
		p95Ms: z.number().nullable(),
		jobs: z.number(),
		nodesTouched: z.number().describe("Nodos distintos tocados."),
		topTools: z.array(
			z.object({ tool: z.string(), calls: z.number(), errors: z.number() }),
		),
	}),
};

export const errorsOutputShape = pageShape(
	z.object({
		type: z.string(),
		count: z.number(),
		lastAt: iso,
		nextStep: z.string().nullable(),
		examples: z.array(
			z.object({
				callId: z.string(),
				tool: z.string(),
				at: iso,
				message: z.string(),
			}),
		),
	}),
);

export const nodesOutputShape = pageShape(
	z.object({
		nodeId: z.string(),
		touches: z.number(),
		lastAt: iso,
		lastCallId: z.string(),
		lastTool: z.string(),
	}),
);

export const sessionsOutputShape = pageShape(
	z.object({
		sessionId: z.string(),
		pid: z.number().nullable(),
		fileUrl: z.string().nullable(),
		startedAt: iso,
		lastSeenAt: iso,
		calls: z.number(),
		writes: z.number(),
		errors: z.number(),
		totalMs: z.number(),
	}),
);

export const searchOutputShape = pageShape(
	z.object({
		callId: z.string(),
		startedAt: iso,
		tool: z.string(),
		status: z.enum(["running", "ok", "error"]),
		ms: z.number().nullable(),
		summary: z.string(),
		errorType: z.string().nullable(),
		jobStatus: z.enum(["running", "done", "failed", "cancelled"]).nullable(),
	}),
);

const buildStepSchema = z.object({
	index: z.number(),
	file: z.string(),
	status: z.enum([
		"pending",
		"running",
		"done",
		"failed",
		"skipped",
		"cancelled",
	]),
	ms: z.number().nullable(),
	touchedCount: z.number(),
	error: errorSchema,
	warning: z.string().nullable(),
	result: z
		.discriminatedUnion("kind", [
			z.object({
				kind: z.literal("inline"),
				excerpt: z.string(),
				bytes: z.number(),
				truncated: z.boolean(),
			}),
			z.object({
				kind: z.literal("file"),
				path: z.string(),
				bytes: z.number(),
			}),
		])
		.nullable()
		.describe(
			"Extracto de lo que devolvió el paso: el JSON compacto cortado al tope (`excerpt`), cuánto ocupa entero (`bytes`) y si se recortó (`truncated`); o la ruta del fichero si pasó del tope de resultados; o null (no devolvió nada, no corrió, o es de un lote anterior). El resultado entero se pide con `step`.",
		),
});

const fullResultSchema = z
	.discriminatedUnion("kind", [
		z.object({ kind: z.literal("inline"), value: z.unknown() }),
		z.object({
			kind: z.literal("file"),
			path: z.string(),
			bytes: z.number(),
		}),
	])
	.nullable()
	.describe(
		"Lo que devolvió el paso, entero: el valor si cupo en el tope de resultados, la ruta del fichero si no, o null.",
	);

const attemptTargetSchema = z.object({
	kind: z.enum(ATTEMPT_KINDS),
	target: z.string(),
	attempts: z.number().describe("Cuántos intentos tiene este objetivo."),
	lastStatus: z.enum(ATTEMPT_STATUSES),
	lastAt: iso,
});

const attemptSchema = z.object({
	id: z.number().describe("Para pedir un contenido con figma_history_script."),
	n: z.number().describe("Número de intento de este objetivo (1, 2, 3…)."),
	kind: z.enum(ATTEMPT_KINDS),
	target: z.string(),
	status: z.enum(ATTEMPT_STATUSES),
	firstError: z.string().nullable(),
	callId: z.string().nullable(),
	jobId: z.string().nullable(),
	stepIndex: z.number().nullable(),
	startedAt: iso,
	finishedAt: iso,
	kit: z.string(),
	kitSha256: z.string(),
	changed: z
		.array(z.enum(ATTEMPT_ROLES))
		.nullable()
		.describe(
			"Papeles que cambiaron respecto al intento anterior de este objetivo (null en el primero).",
		),
	change: z.string().describe("La misma información en una frase."),
	callKept: z
		.boolean()
		.describe(
			"La llamada de este intento sigue en el histórico (la retención puede borrarla y dejar el intento).",
		),
	assets: z.array(
		z.object({
			name: z.string(),
			path: z.string(),
			bytes: z.number(),
			sha256: z.string(),
		}),
	),
	scripts: z.array(
		z.object({
			role: z.enum(ATTEMPT_ROLES),
			path: z.string(),
			sha256: z.string(),
			bytes: z.number(),
			stored: z.enum(["full", "too_big"]),
		}),
	),
});

export const attemptsOutputShape = {
	ok: z.boolean(),
	mode: z
		.enum(["targets", "attempts"])
		.describe(
			"`targets`: lista de objetivos; `attempts`: intentos de un objetivo.",
		),
	items: z.array(z.union([attemptTargetSchema, attemptSchema])),
	total: z.number(),
	truncated: z.boolean(),
};

export const diffInput = {
	from: z
		.number()
		.int()
		.positive()
		.describe("El `id` del intento de partida (de figma_history_attempts)."),
	to: z
		.number()
		.int()
		.positive()
		.describe(
			"El `id` del intento con el que se compara: del MISMO objetivo y tipo que `from`.",
		),
	role: z
		.string()
		.optional()
		.describe(
			"El papel cuyo diff quieres (step, params, kit, hooks, screens, map, plan, recognize…). Sin él, el del primero que cambió.",
		),
	path: z
		.string()
		.optional()
		.describe(
			"La ruta, solo si el papel tiene varias (p. ej. varios ganchos).",
		),
};

const roleDiffSchema = z.object({
	role: z.string(),
	path: z.string(),
	state: z
		.enum(["same", "changed", "added", "removed", "hash_only"])
		.describe(
			"`same` igual; `changed` otro contenido; `added`/`removed` solo en un lado; `hash_only` un lado pasó de FCC_SCRIPT_MAX_BYTES y solo guarda el hash.",
		),
	added: z
		.number()
		.nullable()
		.describe("Líneas añadidas (null si no se calcularon)."),
	removed: z
		.number()
		.nullable()
		.describe("Líneas borradas (null si no se calcularon)."),
});

const assetInfoSchema = z.object({
	name: z.string(),
	path: z.string(),
	bytes: z.number(),
	sha256: z.string(),
});

export const diffOutputShape = {
	ok: z.boolean(),
	from: z.object({ id: z.number(), n: z.number() }),
	to: z.object({ id: z.number(), n: z.number() }),
	target: z.string(),
	kind: z.string(),
	roles: z.array(roleDiffSchema),
	assets: z.array(
		z.object({
			name: z.string(),
			state: z.enum(["same", "changed", "added", "removed"]),
			from: assetInfoSchema.nullable(),
			to: assetInfoSchema.nullable(),
		}),
	),
	diff: z
		.object({
			role: z.string(),
			path: z.string(),
			kind: z
				.enum(["diff", "too_large", "too_big"])
				.describe(
					"`diff`: líneas comparadas; `too_large`: demasiados cambios para compararlos; `too_big`: un lado solo guarda el hash.",
				),
			added: z.number().nullable(),
			removed: z.number().nullable(),
			text: z
				.string()
				.describe(
					"El diff unificado, recortado a FCC_HISTORY_DIFF_INLINE_LINES líneas.",
				),
			truncated: z.boolean(),
			file: z
				.string()
				.nullable()
				.describe(
					"Fichero con el diff entero (`history-diffs/<from>-<to>-<papel>.diff` de la carpeta de salida).",
				),
			fromSha256: z.string().nullable(),
			toSha256: z.string().nullable(),
		})
		.nullable()
		.describe(
			"El diff del papel pedido o del primero que cambió; null si nada cambió.",
		),
};

export const scriptOutputShape = {
	ok: z.boolean(),
	path: z
		.string()
		.describe(
			"Fichero con el contenido exacto, en la carpeta de salida del proyecto.",
		),
	bytes: z.number(),
	sha256: z.string(),
};

export const callOutputShape = {
	ok: z.boolean(),
	call: z.object({
		callId: z.string(),
		sessionId: z.string(),
		fileUrl: z.string().nullable(),
		tool: z.string(),
		startedAt: iso,
		args: z.record(
			z.string(),
			z.union([z.string(), z.number(), z.boolean(), z.null()]),
		),
		status: z.enum(["running", "ok", "error"]),
		ms: z.number().nullable(),
		retryable: z.boolean().nullable(),
		touchedNodeIds: z.array(z.string()),
		error: errorSchema,
		resultPath: z.string().nullable(),
		jobId: z.string().nullable(),
		job: z
			.object({
				status: z.enum(["running", "done", "failed", "cancelled"]),
				ms: z.number().nullable(),
				error: errorSchema,
				touchedNodeIds: z.array(z.string()),
			})
			.nullable(),
		screenshots: z.array(
			z.object({
				nodeId: z.string(),
				path: z.string(),
				width: z.number(),
				height: z.number(),
			}),
		),
		summary: z.string(),
	}),
	// Los intentos que dejó la llamada (un script, un paso por cada uno de un lote, una pantalla por captura)
	attempts: z
		.array(
			z.object({
				id: z.number(),
				n: z.number(),
				kind: z.enum(ATTEMPT_KINDS),
				target: z.string(),
				status: z.enum(ATTEMPT_STATUSES),
			}),
		)
		.optional(),
	// Solo en un lote (figma_build) y sin `step`: los pasos del job, ordenados por índice, con un extracto del resultado
	steps: z.array(buildStepSchema).optional(),
	// Solo con `step`: el resultado entero de ese paso
	stepResult: z
		.object({
			index: z.number(),
			file: z.string(),
			status: z.enum([
				"pending",
				"running",
				"done",
				"failed",
				"skipped",
				"cancelled",
			]),
			result: fullResultSchema,
		})
		.optional(),
};
