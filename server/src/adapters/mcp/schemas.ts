import { z } from "zod";
import {
	ExpectSchema,
	ManifestStepSchema,
} from "#adapters/contracts/build-manifest.ts";
import { SCRIPT_FORMAT } from "#application/ports/figma-gateway.ts";
import { BUILD_STATUS, STEP_STATUS } from "#domain/build.ts";
import {
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
	WEB_ERROR_TYPE,
	WEB_PAGE_REASON,
} from "#domain/figma-error.ts";
import { JOB_STATUS } from "#domain/job.ts";

// Valores por defecto y límites de los parámetros de las herramientas (fijos del programa)
export const TOOL_LIMITS = Object.freeze({
	defaultScreenshotScale: 1,
	minScreenshotScale: 0.01,
	maxScreenshotScale: 4,
	defaultMetadataDepth: 2,
	maxMetadataDepth: 10,
} as const);

export { TOOL_NAME } from "#domain/tool-names.ts";

export const runScriptInput = {
	file: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Ruta del script (absoluta o relativa a la raíz del proyecto), dentro de las raíces permitidas. Úsala siempre para scripts largos: el contenido no pasa por la conversación. Exactamente uno de `file` o `code`.",
		),
	code: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Código inline, solo para fragmentos cortos. Exactamente uno de `file` o `code`.",
		),
	format: z
		.enum([SCRIPT_FORMAT.body, SCRIPT_FORMAT.function])
		.default(SCRIPT_FORMAT.body)
		.describe(
			"`body`: cuerpo de una función async (admite await y termina en return); `params`, `assets` y `kit` son constantes del cuerpo: declarar una con ese nombre no compila. `function`: una expresión `async (params, assets, kit) => { … }` completa (los argumentos son opcionales).",
		),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			"Plazo máximo de la llamada a Chrome en ms; por defecto el de FIGMA_CDP_CALL_TIMEOUT_MS.",
		),
	params: z
		.unknown()
		.optional()
		.describe(
			"Datos pequeños (valor JSON) que el script recibe como `params` (argumento en formato function, constante en body). Tope FCC_MAX_PARAMS_BYTES.",
		),
	assets: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Ficheros binarios por nombre → ruta (dentro de las raíces permitidas). Llegan al script en `assets[nombre]` como Uint8Array. Tope total FCC_MAX_ASSET_BYTES.",
		),
	resultFile: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Nombre de fichero (solo un nombre: letras, números, «_», «.» y «-»; sin «/» ni «..»). El `result` va SIEMPRE a results/<resultFile> de la carpeta de salida del proyecto, aunque sea pequeño, y la respuesta lleva { path, bytes }. Se pisa si existe: sirve para que un script de análisis lea siempre la misma ruta.",
		),
};

export const getJobInput = {
	jobId: z
		.string()
		.min(1)
		.describe("El jobId que devolvió figma_run_script o figma_build."),
	waitMs: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe(
			"Espera hasta waitMs milisegundos a que el job termine y responde en cuanto lo hace; si vence, devuelve su estado actual. Tope: el plazo blando. Sin él, responde al instante.",
		),
};

export const screenshotInput = {
	nodeId: z.string().min(1).describe("Id del nodo a exportar, p. ej. «1:23»."),
	scale: z
		.number()
		.min(TOOL_LIMITS.minScreenshotScale)
		.max(TOOL_LIMITS.maxScreenshotScale)
		.default(TOOL_LIMITS.defaultScreenshotScale)
		.describe("Factor de escala del PNG."),
};

export const metadataInput = {
	nodeId: z
		.string()
		.min(1)
		.optional()
		.describe("Id del nodo raíz del árbol; por defecto, la página actual."),
	depth: z
		.number()
		.int()
		.min(0)
		.max(TOOL_LIMITS.maxMetadataDepth)
		.default(TOOL_LIMITS.defaultMetadataDepth)
		.describe("Niveles de hijos a incluir (0 = solo el nodo)."),
};

export const figmaErrorSchema = z
	.object({
		type: z.enum([
			...Object.values(FIGMA_ERROR_TYPE),
			...Object.values(WEB_ERROR_TYPE),
		]),
		message: z.string(),
		retryable: z.boolean(),
		nextStep: z.string().describe("Qué hacer para resolverlo."),
		path: z.string().optional(),
		line: z.number().nullable().optional(),
		timeoutMs: z.number().optional(),
		nodeId: z.string().optional(),
		field: z
			.string()
			.optional()
			.describe("Solo en ProjectConfigError: el campo que no vale."),
		secretRef: z
			.string()
			.optional()
			.describe("Solo en SecretMissing: el nombre del secreto que falta."),
		reason: z
			.enum([
				...Object.values(FIGMA_NOT_READY_REASON),
				...Object.values(WEB_PAGE_REASON),
			])
			.optional()
			.describe(
				"En FigmaNotReady: `notLoggedIn` (sin sesión), `viewOnly` (sin permiso de edición) o `loading`. En WebPageError: `login`, `navigation` (salió de baseUrl), `chrome` o `load`.",
			),
	})
	.nullable();

const touched = z
	.array(z.string())
	.describe("Ids de los nodos creados o modificados que declaró el script.");

const touchedPath = z
	.string()
	.nullable()
	.describe(
		"Si la lista de ids no cabe en línea, ruta del JSON con la lista completa; touchedNodeIds lleva solo los primeros. null si cabe entera.",
	);

// Si el servidor abrió la pestaña del proyecto para esta llamada (no estaba abierta), la respuesta lo dice
export const tabOpened = z
	.string()
	.optional()
	.describe(
		"Solo si el servidor abrió en Chrome la pestaña del proyecto porque no estaba abierta: qué hizo.",
	);

// Lo que un presenter devuelve para una herramienta: el tipo de su outputSchema (en solo lectura, como los
// datos del dominio). Así renombrar o quitar un campo del esquema rompe tsc en el presenter, no en tiempo de ejecución
type DeepReadonly<T> = T extends readonly (infer U)[]
	? readonly DeepReadonly<U>[]
	: T extends object
		? { readonly [K in keyof T]: DeepReadonly<T[K]> }
		: T;
export type OutputOf<S extends z.ZodRawShape> = DeepReadonly<
	z.infer<z.ZodObject<S>>
>;

export const runOutputShape = {
	status: z
		.enum(Object.values(JOB_STATUS))
		.describe(
			"`running`: sigue ejecutándose; consulta figma_get_job con jobId.",
		),
	jobId: z.string().nullable(),
	ok: z.boolean(),
	result: z
		.unknown()
		.describe(
			"Dato pequeño, o { path, bytes } si era grande y se guardó en disco.",
		),
	error: figmaErrorSchema,
	touchedNodeIds: touched,
	retryable: z.boolean(),
	warning: z
		.string()
		.optional()
		.describe(
			"Solo con ok:true y sin ids declarados: el script no devolvió createdNodeIds ni mutatedNodeIds.",
		),
	tabOpened,
};

export const statusOutputShape = {
	ok: z.boolean(),
	chromeReachable: z.boolean(),
	tabFound: z.boolean(),
	figmaReady: z.boolean(),
	fileName: z.string().nullable(),
	pageName: z.string().nullable(),
	error: figmaErrorSchema,
	retryable: z.boolean(),
	previousScriptRunning: z
		.boolean()
		.describe(
			"Un script que venció su plazo sigue ejecutándose en la pestaña: las escrituras se rechazan hasta que acabe o se recargue la pestaña.",
		),
	nextStep: z.string().nullable(),
	tabOpened,
};

export const screenshotOutputShape = {
	ok: z.boolean(),
	path: z
		.string()
		.nullable()
		.describe("Ruta del PNG en el directorio de salida."),
	bytes: z.number().nullable(),
	width: z.number().nullable(),
	height: z.number().nullable(),
	error: figmaErrorSchema,
	retryable: z.boolean(),
	tabOpened,
};

export const metadataOutputShape = {
	ok: z.boolean(),
	tree: z
		.unknown()
		.describe("Árbol { id, name, type, children? } o null si hubo error."),
	error: figmaErrorSchema,
	retryable: z.boolean(),
	tabOpened,
};

export const buildInput = {
	manifest: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Ruta a un manifiesto JSON de lote (dentro de las raíces). Exactamente uno de `manifest`, `steps`, `areas` o `sheets`; lo normal es `manifest` (versionable y relanzable).",
		),
	steps: z
		.array(ManifestStepSchema)
		.min(1)
		.optional()
		.describe(
			'Lista corta de pasos escrita a mano: `{ file, … }` (un script), `{ use: "kit/<paso>@1", area }` (un paso del kit; sus params salen de areas@1), `{ use: "kit/build-screen@1", screen, area? }` (pinta la pantalla desde su última captura; el servidor arma el plan) o `{ use: "kit/build-component@1", sheet, scratch? }` (pinta la hoja de un componente desde su última captura, sheets@1 y map@1; con `scratch` en una página aparte) o `{ use: "kit/compose@1", compose }` (diseña una pantalla en Figma sin web previa desde el compose@1 `<compose>.json` de la carpeta `compose` del proyecto: se valida antes de tocar Figma). Exactamente uno de `manifest`, `steps`, `areas` o `sheets`.',
		),
	areas: z
		.array(z.string().min(1))
		.min(1)
		.optional()
		.describe(
			"Nombres de áreas de areas@1 (en la carpeta del proyecto): arma el plan de cada una, en este orden: build-screen de cada pantalla con captura (si el proyecto declara `map`) → place → share (si sale en un grupo compartido) → links (si tiene enlaces o punto de inicio) → fill-image (si tiene rellenos); `kit/layout-check@1` no se añade solo: se pide en `steps` o en un manifiesto. Exactamente uno de `manifest`, `steps`, `areas` o `sheets`.",
		),
	sheets: z
		.array(z.string().min(1))
		.min(1)
		.optional()
		.describe(
			"Claves de hojas de componentes de sheets@1 (en la carpeta del proyecto): un `kit/build-component@1` por hoja, en el orden de sheets@1 (las hojas que otras anidan, antes que ellas) y no en el de la lista. Una hoja sin captura válida de su pantalla no tiene paso y sale en `skippedSheets` con NO_SOURCE. Si la hoja ya existe en Figma, se rehace sobre su set (mismo id, variantes emparejadas por props, propiedades por nombre). Exactamente uno de `manifest`, `steps`, `areas` o `sheets`.",
		),
	fromStep: z
		.number()
		.int()
		.min(0)
		.default(0)
		.describe(
			"Índice por el que empezar (para reanudar un lote): los pasos anteriores salen como `skipped`.",
		),
	expect: ExpectSchema.optional().describe(
		"Guarda del lote: nombre que debe tener el archivo abierto. Se comprueba antes de enviar nada, también con `fromStep`; si no coincide, error de uso sin job. Manda sobre el `expect` del manifiesto.",
	),
	stopOnError: z
		.boolean()
		.default(true)
		.describe(
			"Si un paso falla, parar el lote (por defecto) o seguir con el resto.",
		),
	params: z
		.record(z.string(), z.unknown())
		.optional()
		.describe(
			"Params comunes a todos los pasos; cada paso (o el manifiesto) puede sobrescribirlos.",
		),
};

const progressSchema = z
	.object({
		done: z
			.number()
			.describe("Pasos ejecutados en esta llamada (hechos o fallidos)."),
		total: z.number().describe("Pasos del plan."),
		cancelled: z
			.number()
			.describe("Pasos que no llegaron a ejecutarse por la cancelación."),
		skipped: z.number().describe("Pasos omitidos por `fromStep`."),
		current: z
			.object({ index: z.number(), file: z.string() })
			.nullable()
			.describe("El paso en curso, o null si ninguno lo está."),
	})
	.describe(
		"Avance del lote: pasos ejecutados, total, cancelados, omitidos y paso actual.",
	);

const buildStepOutput = z.object({
	index: z.number(),
	file: z.string(),
	status: z.enum(Object.values(STEP_STATUS)),
	ms: z.number().nullable(),
	touchedCount: z.number(),
	error: figmaErrorSchema,
	warning: z
		.string()
		.nullable()
		.describe(
			"Aviso del paso (p. ej. terminó sin declarar nodos), o null si no hay.",
		),
});

const buildSteps = z
	.array(buildStepOutput)
	.describe(
		"Todos los pasos con su estado; el resultado de cada paso queda en el histórico.",
	);

export const buildOutputShape = {
	ok: z.boolean(),
	status: z
		.enum(Object.values(BUILD_STATUS))
		.describe(
			"`running` (consulta figma_get_job) · `done` · `failed` · `cancelled`.",
		),
	jobId: z.string().nullable(),
	result: z
		.null()
		.describe(
			"Siempre null: el resultado de cada paso no viaja en la respuesta.",
		),
	error: figmaErrorSchema,
	touchedNodeIds: touched,
	touchedPath,
	retryable: z.boolean(),
	progress: progressSchema,
	steps: buildSteps,
	skippedSheets: z
		.array(
			z.object({
				sheet: z.string(),
				code: z
					.string()
					.describe("`NO_SOURCE`: la hoja no tiene captura válida."),
				message: z.string(),
			}),
		)
		.optional()
		.describe(
			"Solo con `sheets`: las hojas pedidas que no entraron en el lote y por qué.",
		),
	tabOpened,
};

export const cancelInput = {
	jobId: z
		.string()
		.min(1)
		.describe("El jobId del lote (figma_build) que quieres cancelar."),
};

export const cancelOutputShape = {
	ok: z.boolean(),
	status: z.enum(Object.values(BUILD_STATUS)),
	cancelRequested: z
		.boolean()
		.describe(
			"true si el lote aún no ha acabado (el paso en curso termina solo): sigue con figma_get_job y waitMs.",
		),
	jobId: z.string().nullable(),
	progress: progressSchema.nullable(),
	steps: buildSteps,
	touchedNodeIds: touched,
	touchedPath,
	error: figmaErrorSchema,
};

// Como figma_run_script, pero si el job es un lote añade kind/progress/steps
export const getJobOutputShape = {
	...runOutputShape,
	kind: z.string().optional().describe("`build` si el job es un lote."),
	progress: progressSchema.optional(),
	steps: buildSteps.optional(),
	touchedPath: touchedPath.optional(),
};
