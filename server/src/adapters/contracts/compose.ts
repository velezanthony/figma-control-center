// compose@1: una pantalla o un componente nuevo diseñado en Figma sin web previa.
// Contrato PROPIO (docs/users/contracts.md);  JSON Schema publicado en schemas/compose.v1.json. strictObject: una clave de
// más es un error, y por eso un bloque que mezcla dos clases (`text` y `use`, p. ej.) no cumple. Lo que el esquema no
// ve (la hoja existe, el token existe, no hay números sueltos) lo comprueba domain/compose-check.ts.
import { z } from "zod";
import {
	COMPOSE_CONTRACT,
	COMPOSE_KEY_PATTERN,
	COMPOSE_SIZING,
	type ComposeBlock,
	type ComposeFile,
	IMAGE_FIT,
	STACK_DIRECTION,
} from "#domain/compose.ts";
import type { ComposeIssue } from "#domain/compose-check.ts";

export const COMPOSE_CONTRACT_NAME = Object.freeze({
	name: "compose",
	version: 1,
} as const);

const nonEmpty = z.string().min(1);

const token = nonEmpty.describe(
	"Nombre de una variable o de un estilo de Figma: nunca un número ni un color suelto.",
);

const SizingSchema = z.enum(COMPOSE_SIZING);

const BlockSchema: z.ZodType<ComposeBlock> = z.lazy(() =>
	z.union([
		z.strictObject({
			stack: z.enum(Object.values(STACK_DIRECTION)),
			gap: token.optional(),
			padding: z.union([token, z.array(token).min(1)]).optional(),
			fill: token.optional(),
			radius: token.optional(),
			sizing: z.strictObject({ h: SizingSchema, v: SizingSchema }).optional(),
			name: nonEmpty.optional(),
			children: z.array(BlockSchema),
		}),
		z.strictObject({
			use: z.union([nonEmpty, z.strictObject({ key: nonEmpty })]),
			variant: z.record(z.string(), z.string()).optional(),
			props: z
				.record(z.string(), z.union([z.string(), z.boolean()]))
				.optional(),
			slots: z.record(z.string(), z.array(BlockSchema)).optional(),
			name: nonEmpty.optional(),
		}),
		z.strictObject({
			text: z.string(),
			style: token,
			color: token.optional(),
			name: nonEmpty.optional(),
		}),
		z.strictObject({
			image: nonEmpty.describe("Ruta en la carpeta del proyecto."),
			fit: z.enum(IMAGE_FIT).optional(),
			name: nonEmpty.optional(),
		}),
		z.strictObject({
			icon: nonEmpty.describe("Un nombre del catálogo de iconos de map@1."),
			color: token.optional(),
		}),
	]),
);

export const ComposeSchema = z.strictObject({
	contract: z.literal(COMPOSE_CONTRACT),
	key: z.string().regex(COMPOSE_KEY_PATTERN),
	title: nonEmpty,
	target: z.strictObject({
		page: nonEmpty,
		frame: nonEmpty.optional(),
		width: z.number().positive(),
		height: z.number().positive().optional(),
	}),
	root: BlockSchema,
}) satisfies z.ZodType<ComposeFile>; // el tipo del dominio y el esquema no pueden divergir

// RFC 6901: «~» y «/» dentro de una clave se escapan
const pointerOf = (path: readonly PropertyKey[]): string =>
	path
		.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`)
		.join("");

// Los fallos del esquema, cada uno con su puntero JSON (la aplicación no importa zod: lo cablea la raíz)
export function composeSchemaIssues(value: unknown): ComposeIssue[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [{ pointer: "", message: "no es un objeto" }];
	}
	const parsed = ComposeSchema.safeParse(value);
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
