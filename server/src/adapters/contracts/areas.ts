// areas@1: las áreas de un proyecto en Figma. Contrato PROPIO (docs/users/contracts.md);  JSON Schema
// publicado en schemas/areas.v1.json. strictObject: una clave de más es un error. Lo que cruza con screens@1 y los
// frames de cada área lo comprueba domain/areas-check.ts.
import { z } from "zod";
import {
	AREAS_CONTRACT,
	type AreasFile,
	type AreasIssue,
	LINK_MATCH,
	PLACE_MODE,
	SOURCE_TAKE,
	TRANSITION_EASING,
	TRANSITION_TYPE,
} from "#domain/areas.ts";

export const AREAS_CONTRACT_NAME = Object.freeze({
	name: "areas",
	version: 1,
} as const);

const nonEmpty = z.string().min(1);
// Los nombres de capa son listas: unas pantallas usan un nombre y otras, otro
const names = z.array(nonEmpty).min(1);

const ClickableSchema = z.strictObject({
	names: z.array(nonEmpty),
	namePrefixes: z.array(nonEmpty),
	components: z.array(nonEmpty),
	parts: z
		.array(z.strictObject({ name: nonEmpty, insideComponent: nonEmpty }))
		.optional(),
});

const LinkRulesSchema = z.strictObject({
	clickable: ClickableSchema,
	rows: z.strictObject({ row: names, body: names }),
	transition: z.strictObject({
		type: z.enum(Object.values(TRANSITION_TYPE)),
		easing: z.enum(Object.values(TRANSITION_EASING)),
		duration: z.number().min(0),
	}),
});

const LinkSchema = z.union([
	z.strictObject({
		from: nonEmpty,
		text: nonEmpty,
		match: z.enum(Object.values(LINK_MATCH)).optional(),
		to: nonEmpty,
	}),
	z.strictObject({ from: nonEmpty, rows: z.literal(true), to: nonEmpty }),
]);

const AreaSchema = z.strictObject({
	name: nonEmpty,
	page: nonEmpty.describe("Página de Figma, por nombre recortado."),
	frame: z.strictObject({
		width: z.number().int().positive(),
		minHeight: z.number().int().positive(),
		fill: nonEmpty
			.optional()
			.describe("Variable de color del relleno por defecto del frame."),
		clip: z.boolean().optional(),
	}),
	place: z.strictObject({
		mode: z.enum(Object.values(PLACE_MODE)),
		source: z.strictObject({
			pagePrefix: nonEmpty.describe(
				"Las páginas temporales se llaman prefijo + frame.",
			),
			take: z.enum(Object.values(SOURCE_TAKE)),
			remove: z.boolean().optional(),
		}),
		unwrap: z.strictObject({ holding: names }).optional(),
		keep: names.optional(),
		drop: names.optional(),
		strokeScale: z.number().positive().optional(),
	}),
	shell: z
		.strictObject({
			set: nonEmpty,
			in: names,
			variantProp: nonEmpty,
			default: nonEmpty,
			fixed: z.strictObject({ height: z.number().positive() }).optional(),
		})
		.optional(),
	main: names.optional(),
	screens: z
		.array(
			z.strictObject({
				frame: nonEmpty,
				screen: nonEmpty.optional(),
				shell: nonEmpty.optional(),
			}),
		)
		.min(1),
	clickable: ClickableSchema.optional(),
	links: z.array(LinkSchema).optional(),
	flowStart: z.strictObject({ frame: nonEmpty, name: nonEmpty }).optional(),
	fills: z
		.array(
			z.strictObject({
				frame: nonEmpty,
				find: z.strictObject({
					text: nonEmpty,
					minSize: z.tuple([z.number().positive(), z.number().positive()]),
				}),
				asset: nonEmpty.describe("Ruta relativa a este fichero."),
				name: nonEmpty.optional(),
			}),
		)
		.optional(),
});

const SharedSchema = z.strictObject({
	name: nonEmpty,
	set: nonEmpty,
	page: z.strictObject({ name: nonEmpty, after: nonEmpty.optional() }),
	part: names,
	variantProp: nonEmpty,
	from: z
		.array(z.strictObject({ area: nonEmpty, frame: nonEmpty, value: nonEmpty }))
		.min(1),
	sheet: z
		.strictObject({
			gap: z.number().min(0),
			padding: z.number().min(0),
		})
		.optional(),
});

export const AreasSchema = z.strictObject({
	contract: z.literal(AREAS_CONTRACT),
	linkRules: LinkRulesSchema,
	areas: z
		.array(AreaSchema)
		.min(1)
		.refine((list) => new Set(list.map((a) => a.name)).size === list.length, {
			message: "hay áreas con el mismo nombre",
		}),
	shared: z.array(SharedSchema).optional(),
}) satisfies z.ZodType<AreasFile>; // el tipo del dominio y el esquema no pueden divergir

// RFC 6901: «~» y «/» dentro de una clave se escapan
const pointerOf = (path: readonly PropertyKey[]): string =>
	path
		.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`)
		.join("");

// De una unión que no cumple ninguna rama, los problemas de la rama más cercana (la que tiene menos)
function flatten(issue: z.core.$ZodIssue): AreasIssue[] {
	if (issue.code === "unrecognized_keys") {
		return [
			{
				pointer: pointerOf(issue.path),
				message: `clave no admitida: ${issue.keys.join(", ")}`,
			},
		];
	}
	if (issue.code === "invalid_union") {
		const branches = issue.errors.map((issues) =>
			issues.flatMap((nested) =>
				flatten({ ...nested, path: [...issue.path, ...nested.path] }),
			),
		);
		const best = branches.reduce<AreasIssue[] | undefined>(
			(a, b) => (a === undefined || b.length < a.length ? b : a),
			undefined,
		);
		if (best !== undefined && best.length > 0) return best;
	}
	return [{ pointer: pointerOf(issue.path), message: issue.message }];
}

// Los problemas de un fichero con el puntero JSON de cada uno (vacío = cumple el esquema)
export function areasSchemaIssues(value: unknown): AreasIssue[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [{ pointer: "", message: "no es un objeto" }];
	}
	const parsed = AreasSchema.safeParse(value);
	if (parsed.success) return [];
	return parsed.error.issues.flatMap(flatten);
}
