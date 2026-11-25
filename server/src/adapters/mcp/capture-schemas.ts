// Entrada y salida de figma_capture. La salida es la común de las herramientas
// ({ ok, status, jobId, error, retryable, touchedNodeIds }) más los ficheros, el resumen y los errores recortados.
import { z } from "zod";
import { JOB_STATUS } from "#domain/job.ts";
import { figmaErrorSchema } from "./schemas.ts";

export const captureInput = {
	screens: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			"Claves de las pantallas del screens@1 del proyecto que se capturan, en orden.",
		),
	allowPageWorld: z
		.boolean()
		.optional()
		.describe(
			"true para las pantallas con `evaluateInPage` (código en el mundo de la página): sin él, son un error de uso.",
		),
};

const file = z.strictObject({ screen: z.string(), path: z.string() });

export const captureOutputShape = {
	ok: z.boolean(),
	status: z
		.enum(Object.values(JOB_STATUS))
		.describe(
			"`done`/`failed`: terminó. `running`: sigue; consulta figma_get_job con jobId (y waitMs).",
		),
	jobId: z
		.string()
		.nullable()
		.describe(
			"El job de la captura; null si no llegó a empezar (configuración o secretos).",
		),
	path: z
		.string()
		.nullable()
		.describe(
			"La primera captura de la web guardada (o rechazada); null si no hay ninguna.",
		),
	files: z
		.array(file)
		.describe(
			"Las capturas válidas, en web-captures/<día>/ de la carpeta de salida del proyecto.",
		),
	rejected: z
		.array(file.extend({ errorsPath: z.string() }))
		.describe(
			"Las que no cumplen capture@1: en rejected/, con la lista entera de errores al lado.",
		),
	summary: z
		.array(z.string())
		.describe(
			"Una línea por pantalla con variantes, nodos, imágenes y avisos. Nunca el árbol.",
		),
	errors: z
		.array(
			z.strictObject({
				screen: z.string(),
				code: z.string(),
				message: z.string(),
				nodeId: z.string().optional(),
				path: z.string().optional(),
			}),
		)
		.describe(
			"Errores de contrato, como mucho FCC_CONTRACT_INLINE_ERRORS; el resto en el fichero de errores.",
		),
	errorCount: z.number().int().nonnegative(),
	error: figmaErrorSchema,
	retryable: z.boolean(),
	touchedNodeIds: z
		.array(z.string())
		.max(0)
		.describe("Siempre vacío: no toca Figma."),
};
