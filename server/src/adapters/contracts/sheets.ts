// sheets@1: los datos de cada hoja de componente. Contrato PROPIO (docs/users/contracts.md);  JSON
// Schema publicado en schemas/sheets.v1.json. strictObject: una clave de más es un error. Lo que el esquema no ve (claves
// repetidas, el cruce con screens@1) lo comprueba domain/sheets-check.ts.
import { z } from "zod";
import {
	SHEETS_CONTRACT,
	type Sheet,
	type SheetsFile,
	type SheetsIssue,
} from "#domain/sheets.ts";

export const SHEETS_CONTRACT_NAME = Object.freeze({
	name: "sheets",
	version: 1,
} as const);

const nonEmpty = z.string().min(1);
// La clave de una hoja nombra los ficheros de su plan: sin barras, espacios ni puntos
const SHEET_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const variable = nonEmpty.describe("Nombre de una variable de Figma.");

export const StyleSchema = z.strictObject({
	header: z.strictObject({ fill: variable, text: variable }),
	card: z.strictObject({ fill: variable }),
	texts: z.strictObject({
		description: variable,
		bug: variable,
		tag: variable,
		rowLabel: variable,
		colLabel: variable,
	}),
	bug: z
		.strictObject({ prefix: z.string(), setPrefix: z.string() })
		.optional()
		.describe(
			"Los textos del aviso de fallo conocido, en la tarjeta y en el set.",
		),
	matrix: z.strictObject({ stroke: variable }),
});

const FingerprintSchema = z
	.strictObject({
		variantProps: z.record(nonEmpty, z.array(z.string())),
		variants: z.array(nonEmpty),
		properties: z.array(nonEmpty),
		layers: z.array(
			z.strictObject({
				name: z.string(),
				type: nonEmpty,
				properties: z.array(nonEmpty),
				variants: z.array(nonEmpty),
			}),
		),
	})
	.describe(
		"Cómo estaba el set en Figma al decidir: props de variante con sus valores, nombres de variantes y de propiedades (sin `#id`) y sus capas hechas a mano (nombre, tipo, propiedades que usan y variantes donde están), ordenados. El informe de SHEET_DRIFT la trae lista para copiar.",
	);

export const DriftSchema = z
	.union([
		z.strictObject({
			decision: z.enum(["figma", "web"]),
			fingerprint: FingerprintSchema,
		}),
		z.strictObject({
			decision: z.literal("map"),
			values: z
				.record(nonEmpty, nonEmpty)
				.refine((v) => Object.keys(v).length > 0, "al menos un valor"),
			fingerprint: FingerprintSchema,
		}),
	])
	.describe(
		"Qué hacer cuando Figma va por delante de la web: `figma` (se salta la hoja), `web` (se rehace aceptando perder lo de Figma) o `map` (las variantes de la web se emparejan añadiéndoles `values` para las props que solo tiene Figma).",
	);

export const SheetSchema = z.strictObject({
	key: z.string().regex(SHEET_KEY),
	screen: nonEmpty.describe("Pantalla de screens@1 de la que sale la hoja."),
	title: nonEmpty,
	page: z.strictObject({
		name: nonEmpty,
		after: nonEmpty.optional(),
		section: nonEmpty.optional(),
	}),
	description: z.string(),
	bug: nonEmpty.optional(),
	tag: nonEmpty.optional(),
	source: nonEmpty
		.optional()
		.describe(
			"Ruta de la plantilla del componente en el código del proyecto (el mapeo a código de design-context@1).",
		),
	matrix: z
		.strictObject({
			rows: z.array(nonEmpty).optional(),
			align: z.enum(["top", "center"]).optional(),
		})
		.optional(),
	texts: z
		.array(z.strictObject({ name: nonEmpty, match: nonEmpty }))
		.optional(),
	booleans: z
		.array(
			z.strictObject({
				name: nonEmpty,
				layer: nonEmpty,
				on: z.boolean().optional(),
			}),
		)
		.optional(),
	icons: z
		.array(
			z.strictObject({
				icon: nonEmpty,
				boolean: nonEmpty.optional(),
				swap: nonEmpty.optional(),
				on: z.boolean().optional(),
				noBooleanWhen: z.record(nonEmpty, z.string()).optional(),
			}),
		)
		.optional(),
	slots: z
		.array(
			z.strictObject({
				name: nonEmpty,
				layer: nonEmpty,
				boolean: nonEmpty.optional(),
			}),
		)
		.optional(),
	names: z
		.array(z.strictObject({ classes: nonEmpty, name: nonEmpty }))
		.optional(),
	exposed: z.array(nonEmpty).optional(),
	flowIcons: z.boolean().optional(),
	rules: z.array(nonEmpty).optional(),
	keep: z.array(nonEmpty).optional(),
	drift: DriftSchema.optional(),
}) satisfies z.ZodType<Sheet>;

export const SheetsSchema = z.strictObject({
	contract: z.literal(SHEETS_CONTRACT),
	style: StyleSchema,
	sections: z
		.record(nonEmpty, z.strictObject({ default: z.boolean().optional() }))
		.optional(),
	sheets: z.array(SheetSchema),
}) satisfies z.ZodType<SheetsFile>; // el tipo del dominio y el esquema no pueden divergir

// RFC 6901: «~» y «/» dentro de una clave se escapan
const pointerOf = (path: readonly PropertyKey[]): string =>
	path
		.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`)
		.join("");

export function sheetsSchemaIssues(value: unknown): SheetsIssue[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [{ pointer: "", message: "no es un objeto" }];
	}
	const parsed = SheetsSchema.safeParse(value);
	if (parsed.success) return [];
	return parsed.error.issues.map((issue) =>
		issue.code === "unrecognized_keys"
			? {
					pointer: pointerOf(issue.path),
					message: `clave no admitida: ${issue.keys.join(", ")}`,
				}
			: { pointer: pointerOf(issue.path), message: issue.message },
	);
}
