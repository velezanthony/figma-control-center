// screens@1: qué pantallas se capturan y con qué variantes. Contrato PROPIO (docs/users/contracts.md);
// JSON Schema publicado en schemas/screens.v1.json. Lo que cruza con project@1 (una `session` sin usuario) lo
// comprueba quien lee los dos (adapters/fs/fs-project-config.ts).
import { z } from "zod";
import { CONTRACT, FORCED_STATES, type ScreensFile } from "#domain/capture.ts";
import { sitePath, ViewportSchema } from "./project.ts";

export const SCREENS_CONTRACT = Object.freeze({
	name: "screens",
	version: 1,
} as const);

// La clave nombra los ficheros de salida (<pantalla>_<HHMMSS>.json): sin barras ni puntos
const SCREEN_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const expression = z.string().min(1);

export const ActionSchema = z.union([
	z.strictObject({
		click: z.string().min(1).describe("Selector: clic en el mundo aislado."),
	}),
	z.strictObject({
		evaluateInPage: expression.describe(
			"Expresión en el mundo de la página: pide allowPageWorld (D-2).",
		),
	}),
]);

const ForceSchema = z.strictObject({
	selector: z
		.string()
		.min(1)
		.describe("El primer elemento que casa en el documento principal."),
	state: z.enum(FORCED_STATES),
});

const VariantSchema = z.strictObject({
	props: z.record(z.string(), z.string()),
	query: z
		.record(z.string().min(1), z.string())
		.optional()
		.describe(
			"Pares que se añaden a la url de la pantalla, en el orden escrito (urlencode).",
		),
	run: z.array(ActionSchema).optional(),
	until: expression
		.optional()
		.describe("Se sondea en el mundo aislado hasta que es verdadera."),
	viewport: ViewportSchema.optional().describe(
		"Tamaño de la pestaña solo para esta variante; sin él, el de la pantalla o el de project@1.",
	),
	force: z
		.array(ForceSchema)
		.min(1)
		.optional()
		.describe(
			"Pseudoclases que se fuerzan (CSS.forcePseudoState) tras las acciones y el `until` y antes de medir, y se quitan al acabar la variante. Un selector que no existe es WebPageError.",
		),
});

const ScreenSchema = z.strictObject({
	key: z.string().regex(SCREEN_KEY),
	title: z.string().min(1),
	url: sitePath,
	session: z.string().min(1).optional(),
	pick: z.string().min(1).optional(),
	until: expression.optional(),
	viewport: ViewportSchema.optional().describe(
		"Tamaño de la pestaña solo para esta pantalla; sin él, el de project@1.",
	),
	variants: z.array(VariantSchema).min(1).optional(),
});

export const ScreensSchema = z.strictObject({
	contract: z.literal(CONTRACT.screens),
	screens: z
		.array(ScreenSchema)
		.min(1)
		.refine((list) => new Set(list.map((s) => s.key)).size === list.length, {
			message: "hay claves de pantalla repetidas",
		}),
}) satisfies z.ZodType<ScreensFile>; // el tipo del dominio y el esquema no pueden divergir
