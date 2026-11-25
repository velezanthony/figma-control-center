import { z } from "zod";
import { EXPORT_FORMAT, STYLE_KIND } from "#domain/catalog.ts";
import { JOB_STATUS } from "#domain/job.ts";
import { figmaErrorSchema, TOOL_LIMITS, tabOpened } from "./schemas.ts";

// Entradas y salida común de las lecturas del catálogo. La salida no se publica en schemas/
// (solo el manifiesto de figma_build lo está).

const exactName = (what: string) =>
	z.string().min(1).describe(`Nombre exacto ${what}.`);

export const variablesInput = {
	collection: exactName(
		"de la colección de variables (p. ej. «Tokens»); sin él, todas las colecciones locales",
	).optional(),
	nodeId: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Id de un nodo, p. ej. «1:23»: solo salen las variables ligadas en su subárbol y dónde (`bindings`: nodo, campo, variable).",
		),
};

export const stylesInput = {
	kind: z
		.enum(Object.values(STYLE_KIND))
		.optional()
		.describe("Solo ese tipo de estilo; sin él, los cuatro."),
};

export const componentsInput = {
	page: exactName("de la página; sin él, todas las páginas").optional(),
	query: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Texto que debe aparecer en el nombre del set o del componente (sin distinguir mayúsculas).",
		),
};

export const instancesInput = {
	pages: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"Nombres exactos de las páginas que se recorren (al menos una). Una que no existe es un error con su nombre.",
		),
	frame: exactName(
		"de un frame de primer nivel; sin él, todos los de esas páginas",
	).optional(),
};

export const exportInput = {
	nodeIds: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"Ids de los nodos a exportar (al menos uno; como mucho FIGMA_EXPORT_MAX_NODES, ajuste «Nodos por exportación»).",
		),
	format: z
		.enum(Object.values(EXPORT_FORMAT))
		.describe("Formato de cada fichero: PNG, JPG, SVG o PDF."),
	scale: z
		.number()
		.min(TOOL_LIMITS.minScreenshotScale)
		.max(TOOL_LIMITS.maxScreenshotScale)
		.default(TOOL_LIMITS.defaultScreenshotScale)
		.describe(
			"Factor de escala (los mismos límites que figma_screenshot). Solo cuenta en PNG y JPG.",
		),
};

export const designContextInput = {
	nodeId: z
		.string()
		.min(1)
		.describe(
			"Id del nodo de Figma (un frame de pantalla, una instancia o un set de componentes), p. ej. «10:1».",
		),
	maxNodes: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			"Nodos como mucho en el contexto (sin él, el ajuste «Nodos por contexto de diseño»). Lo que no cabe sale en `truncated`, con sus ids en el fichero, para pedirlo aparte.",
		),
	screenshot: z
		.boolean()
		.default(true)
		.describe(
			"Saca también la captura del nodo (sale en Capturas del panel, es el objetivo visual). `false` en lotes de nodos.",
		),
	variant: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Solo si `nodeId` es un set de componentes: la variante que se recorre, como { propiedad: opción } (basta con algunas propiedades). Sin ella, la que el set trae por defecto; el resto va como tabla de variantes. Una que no existe es un error con las opciones válidas.",
		),
};

const summaryValue = z.union([z.number(), z.record(z.string(), z.number())]);

// Salida común de las cinco (decisión 10)
export const readOutputShape = {
	ok: z.boolean(),
	status: z
		.enum(Object.values(JOB_STATUS))
		.describe(
			"`done`/`failed`: la lectura terminó. `running`: sigue; consulta figma_get_job con jobId (y waitMs).",
		),
	jobId: z
		.string()
		.nullable()
		.describe(
			"El job de la lectura (toda lectura lo tiene); null solo si no llegó a enviarse.",
		),
	path: z
		.string()
		.nullable()
		.describe(
			"Ruta del JSON completo en reads/ de la carpeta de salida del proyecto (en figma_export, el índice de ficheros). null si no terminó o falló.",
		),
	summary: z
		.record(z.string(), summaryValue)
		.nullable()
		.describe("Conteos pequeños para la conversación (nunca la lista)."),
	error: figmaErrorSchema,
	retryable: z.boolean(),
	touchedNodeIds: z
		.array(z.string())
		.describe("Siempre vacía: las lecturas no tocan ningún nodo."),
	tabOpened,
};

// Salida de figma_design_context: la común más lo que importa de la lectura para no abrir el fichero
export const designContextOutputShape = {
	...readOutputShape,
	screenshotPath: z
		.string()
		.nullable()
		.describe(
			"Ruta de la captura del nodo (en screenshots/ de la carpeta de salida). null si no se pidió, si falló (aviso SCREENSHOT_FAILED) o si la lectura no terminó.",
		),
	warnings: z
		.array(
			z.object({
				code: z.string(),
				message: z.string(),
				component: z.string().optional(),
			}),
		)
		.describe(
			"Los cinco primeros avisos (NO_CODE_MAPPING: un componente sin plantilla; SCREENSHOT_FAILED). El fichero los lleva todos.",
		),
	unmapped: z
		.array(
			z.object({
				node: z.string(),
				name: z.string(),
				fields: z.array(z.string()),
			}),
		)
		.describe(
			"Los cinco primeros nodos con valores sueltos (sin variable ni estilo): o falta un token o el diseño se salió del sistema. El fichero los lleva todos en `hints.unmapped`.",
		),
	truncated: z
		.object({ reason: z.string(), missing: z.number() })
		.nullable()
		.describe(
			"Si el tope de nodos cortó la lectura: cuántos nodos quedaron sin leer (sus ids, en `truncated.children` del fichero). null si se leyó todo.",
		),
};
