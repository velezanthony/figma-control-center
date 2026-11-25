// design-context@1: el contexto de diseño de un nodo de Figma. Contrato PROPIO (docs/users/contracts.md);  JSON Schema publicado en schemas/design-context.v1.json. strictObject: una clave de más es un error.
import { z } from "zod";
import {
	CODE_BY,
	COMPONENT_KIND,
	DESIGN_CONTEXT_CONTRACT,
	DESIGN_WARNING,
	type DesignContext,
	LAYOUT_MODE,
	ORIGIN_KIND,
	SIZING,
	STYLE_KINDS,
	TRUNCATED_REASON,
} from "#domain/design-context.ts";

export const DESIGN_CONTEXT_CONTRACT_NAME = Object.freeze({
	name: "design-context",
	version: 1,
} as const);

const nonEmpty = z.string().min(1);
const id = nonEmpty.describe("Id de un nodo, de una variable o de un estilo.");

const RawSchema = z
	.union([
		z.number(),
		z.string(),
		z.boolean(),
		z.array(z.unknown()),
		z.record(z.string(), z.unknown()),
	])
	.describe(
		"Un valor crudo de Figma: un número, un texto, un booleano o un objeto (una pintura, un efecto…).",
	);

const ValueSchema = z
	.union([
		z.strictObject({ raw: RawSchema }),
		z.strictObject({ variable: id }),
		z.strictObject({ style: id }),
	])
	.describe(
		"Suelto (`raw`: hay que mirarlo dos veces), una variable (por su id en `variables`) o un estilo (por su id en `styles`).",
	);

const MeasureSchema = z.strictObject({
	unit: nonEmpty,
	value: z.number().optional(),
});

const FontSchema = z.strictObject({
	family: z.string(),
	style: z.string(),
	size: z.number(),
	lineHeight: MeasureSchema,
	letterSpacing: MeasureSchema,
});

const OriginSchema = z.strictObject({
	kind: z.enum(Object.values(ORIGIN_KIND)),
	key: nonEmpty,
});

const SizingSchema = z.enum(Object.values(SIZING));

const LimitSchema = z.strictObject({
	w: z.number().optional(),
	h: z.number().optional(),
});

const NodeSchema = z.strictObject({
	id,
	parent: id.nullable(),
	name: z.string(),
	type: nonEmpty,
	visible: z.boolean(),
	box: z.strictObject({
		x: z.number(),
		y: z.number(),
		w: z.number(),
		h: z.number(),
	}),
	layout: z
		.strictObject({
			mode: z.enum(Object.values(LAYOUT_MODE)),
			wrap: z.boolean(),
			gap: ValueSchema,
			counterGap: ValueSchema.optional(),
			padding: z.tuple([ValueSchema, ValueSchema, ValueSchema, ValueSchema]),
			primaryAlign: nonEmpty,
			counterAlign: nonEmpty,
		})
		.optional(),
	placement: z
		.strictObject({
			sizing: z.strictObject({ h: SizingSchema, v: SizingSchema }),
			positioning: z.literal("ABSOLUTE").optional(),
			min: LimitSchema.optional(),
			max: LimitSchema.optional(),
		})
		.optional(),
	fills: z.array(ValueSchema).optional(),
	strokes: z.array(ValueSchema).optional(),
	strokeWeight: ValueSchema.optional(),
	effects: z.array(ValueSchema).optional(),
	radius: z
		.strictObject({
			tl: ValueSchema,
			tr: ValueSchema,
			br: ValueSchema,
			bl: ValueSchema,
		})
		.optional(),
	opacity: z.number().optional(),
	text: z
		.strictObject({
			characters: z.string(),
			font: FontSchema,
			style: id.optional(),
			segments: z
				.array(
					z.strictObject({
						start: z.number(),
						end: z.number(),
						font: FontSchema,
					}),
				)
				.optional(),
		})
		.optional(),
	instance: z
		.strictObject({
			component: nonEmpty,
			variant: z.record(z.string(), z.string()),
			props: z.record(z.string(), z.union([z.string(), z.boolean()])),
			overridden: z.array(z.string()),
		})
		.optional(),
	matched: z.strictObject({ by: nonEmpty }).optional(),
	hints: z
		.strictObject({
			classes: z.array(nonEmpty),
			unmapped: z.array(nonEmpty),
		})
		.optional(),
});

const VariableSchema = z.strictObject({
	name: nonEmpty,
	collection: z.string(),
	type: nonEmpty,
	value: RawSchema,
	aliasOf: z.array(nonEmpty).optional(),
	codeClass: nonEmpty.optional(),
});

const StyleSchema = z.strictObject({
	name: nonEmpty,
	kind: z.enum(STYLE_KINDS),
	key: z.string(),
	value: RawSchema,
});

const ComponentSchema = z.strictObject({
	name: nonEmpty,
	kind: z.enum(Object.values(COMPONENT_KIND)),
	key: z.string(),
	remote: z.boolean(),
	library: nonEmpty.optional(),
	variants: z.record(z.string(), z.array(z.string())),
	properties: z.array(
		z.strictObject({
			name: nonEmpty,
			type: nonEmpty,
			default: z.union([z.string(), z.boolean(), z.null()]),
		}),
	),
	sheet: nonEmpty.optional(),
	code: z
		.strictObject({
			source: nonEmpty.describe("Ruta de la plantilla (`source` de la hoja)."),
			tag: nonEmpty.optional(),
			by: z
				.enum(Object.values(CODE_BY))
				.describe(
					"`key`: el set lleva `fcc:sheet:<clave>`. `name`: la hoja se encontró por el nombre del set (R-1).",
				),
		})
		.optional(),
	candidates: z.array(nonEmpty).optional(),
});

export const DesignContextSchema = z.strictObject({
	contract: z.literal(DESIGN_CONTEXT_CONTRACT),
	file: z.strictObject({ key: z.string(), name: z.string() }),
	readAt: nonEmpty.describe("ISO 8601."),
	root: id,
	origin: OriginSchema.optional(),
	nodes: z
		.array(NodeSchema)
		.describe("En anchura: el padre siempre antes que sus hijos."),
	variables: z.record(z.string(), VariableSchema),
	styles: z.record(z.string(), StyleSchema),
	components: z.record(z.string(), ComponentSchema),
	truncated: z
		.strictObject({
			reason: z.literal(TRUNCATED_REASON),
			children: z.array(id),
		})
		.optional(),
	warnings: z
		.array(
			z.strictObject({
				code: z.enum(Object.values(DESIGN_WARNING)),
				message: nonEmpty,
				component: nonEmpty.optional(),
			}),
		)
		.optional(),
}) satisfies z.ZodType<DesignContext>; // el tipo del dominio y el esquema no pueden divergir

// Lo que devuelve el script de la pestaña: el contexto sin lo que pone el servidor (la clave del archivo, la hora, el
// contrato y los avisos). Con un set como raíz y una variante que no existe, solo las opciones válidas
export const DesignReadSchema = z.union([
	z.strictObject({
		unknownVariant: z.strictObject({
			variants: z.record(z.string(), z.array(z.string())),
		}),
	}),
	DesignContextSchema.omit({
		contract: true,
		file: true,
		readAt: true,
		warnings: true,
	}).extend({ fileName: z.string() }),
]);
