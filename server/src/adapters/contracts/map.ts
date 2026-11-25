// map@1: la correspondencia código → Figma de un proyecto. Contrato PROPIO (docs/users/contracts.md);
// JSON Schema publicado en schemas/map.v1.json. strictObject: una clave de más es un error. Lo que el esquema no ve
// (expresiones regulares que no compilan o son largas) lo comprueba domain/map-check.ts.
import { z } from "zod";
import {
	type Fingerprints,
	MAP_CONTRACT,
	type MapFile,
	type MapIssue,
} from "#domain/map.ts";

export const MAP_CONTRACT_NAME = Object.freeze({
	name: "map",
	version: 1,
} as const);

const nonEmpty = z.string().min(1);

const TokensSchema = z.strictObject({
	collections: z
		.array(nonEmpty)
		.min(1)
		.describe("Colecciones de variables donde buscar."),
	classPrefixes: z.strictObject({
		fill: z.array(nonEmpty),
		text: z.array(nonEmpty),
		stroke: z.array(nonEmpty),
		svg: z
			.array(nonEmpty)
			.optional()
			.describe("Para el color de un svg; sin él, text + stroke + fill."),
	}),
	classToVariable: z
		.array(
			z.strictObject({
				from: nonEmpty.describe(
					"Expresión regular sobre la clase sin prefijo.",
				),
				to: nonEmpty.describe(
					"Nombre de la variable; `$1` es el primer grupo.",
				),
			}),
		)
		.describe("En orden: la primera que da una variable."),
	fallback: z
		.strictObject({ collection: nonEmpty })
		.optional()
		.describe(
			"Si ninguna clase sirve: la primera variable de esa colección con ese color.",
		),
	numbers: z
		.strictObject({
			radius: z
				.strictObject({ prefix: nonEmpty, full: nonEmpty.optional() })
				.optional(),
			spacing: z.strictObject({ prefix: nonEmpty }).optional(),
		})
		.optional()
		.describe("Variables numéricas por valor exacto (±0,01)."),
});

const FontsSchema = z.strictObject({
	families: z.array(z.strictObject({ match: nonEmpty, family: nonEmpty })),
	default: nonEmpty,
	styles: z
		.record(nonEmpty, nonEmpty)
		.describe("Peso CSS → estilo de Figma («400»: «Regular»)."),
	italic: z.strictObject({ suffix: nonEmpty }),
	strict: z.array(nonEmpty).optional(),
	fallback: nonEmpty.optional(),
});

const IconsSchema = z.strictObject({
	pages: nonEmpty.describe(
		"Expresión regular del nombre de las páginas de iconos.",
	),
	prefix: nonEmpty.describe(
		"Lo que lleva delante el nombre de cada icono en Figma.",
	),
	catalog: nonEmpty.describe(
		"Ruta a un JSON [{ name, svg }], relativa a este fichero.",
	),
	glyphs: z
		.strictObject({ classPattern: nonEmpty, prefix: nonEmpty })
		.optional(),
});

const ComponentsSchema = z.strictObject({
	fingerprints: nonEmpty.describe(
		"Ruta a un JSON { <componente>: huella }, relativa a este fichero.",
	),
	leaf: z
		.array(nonEmpty)
		.describe("Los componentes de las huellas que se reconocen."),
	genericClasses: z
		.array(nonEmpty)
		.describe(
			"Clases de maquetación que no distinguen un componente: expresiones sobre la clase entera.",
		),
});

const ScreenRulesSchema = z.strictObject({
	rules: z
		.array(nonEmpty)
		.optional()
		.describe(
			"Las reglas de recognize@1 que se prueban en esa pantalla; sin ellas, todas.",
		),
});

export const MapSchema = z.strictObject({
	contract: z.literal(MAP_CONTRACT),
	tokens: TokensSchema,
	fonts: FontsSchema,
	effects: z.strictObject({ classPattern: nonEmpty }).optional(),
	icons: IconsSchema,
	layers: z.strictObject({
		roles: z.record(nonEmpty, nonEmpty),
		textPrefix: z.boolean(),
	}),
	screen: z.strictObject({ background: nonEmpty.optional() }).optional(),
	components: ComponentsSchema.optional(),
	screens: z.record(nonEmpty, ScreenRulesSchema).optional(),
}) satisfies z.ZodType<MapFile>; // el tipo del dominio y el esquema no pueden divergir

// RFC 6901: «~» y «/» dentro de una clave se escapan
const pointerOf = (path: readonly PropertyKey[]): string =>
	path
		.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`)
		.join("");

export function mapSchemaIssues(value: unknown): MapIssue[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [{ pointer: "", message: "no es un objeto" }];
	}
	const parsed = MapSchema.safeParse(value);
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

// Una huella de fingerprints.json: lo que usa el reconocimiento. Una clave de más (las huellas las genera otra herramienta) no
// es un error
const SigSchema = z.strictObject({ tag: nonEmpty, cls: z.array(z.string()) });

export const FingerprintSchema = z.looseObject({
	title: nonEmpty,
	tag: nonEmpty,
	cls: z.array(z.string()),
	opt: z.array(z.string()).optional(),
	cond: z.record(z.string(), z.tuple([z.string(), z.string()])).optional(),
	defaults: z.record(z.string(), z.string()).optional(),
	alias: z.record(z.string(), z.string()).optional(),
	sig: SigSchema.nullish(),
	sig_cond: SigSchema.nullish(),
});

export const FingerprintsSchema = z.record(
	z.string(),
	FingerprintSchema,
) satisfies z.ZodType<Fingerprints>;

export function fingerprintsSchemaIssues(value: unknown): MapIssue[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [{ pointer: "", message: "no es un objeto" }];
	}
	const parsed = FingerprintsSchema.safeParse(value);
	return parsed.success
		? []
		: parsed.error.issues.map((issue) => ({
				pointer: pointerOf(issue.path),
				message: issue.message,
			}));
}
