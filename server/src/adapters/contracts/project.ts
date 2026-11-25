// project@1: la configuración de captura de un proyecto, en `figma-control-center.json` de su
// carpeta. Solo datos. Contrato PROPIO (docs/users/contracts.md);  JSON Schema publicado en schemas/project.v1.json.
// strictObject: una clave de más es un error. Ningún campo pide marcas en el HTML del proyecto.
import { z } from "zod";
import { CONTRACT, type ProjectConfig } from "#domain/capture.ts";

export const PROJECT_CONTRACT = Object.freeze({
	name: "project",
	version: 1,
} as const);

const HTTP_URL = /^https?:\/\//;

const nonEmpty = z.string().min(1);

// Una ruta bajo baseUrl: empieza por «/» (con su query string si hace falta), nunca una URL entera
export const sitePath = z
	.string()
	.regex(/^\/(?!\/)/, "una ruta bajo baseUrl: empieza por «/»");

export const ViewportSchema = z.strictObject({
	w: z.number().int().positive(),
	h: z.number().int().positive(),
});

const LoginSchema = z.strictObject({
	path: sitePath.describe("Ruta del formulario de login bajo baseUrl."),
	fields: z.strictObject({
		user: nonEmpty.describe("Selector del campo de usuario."),
		password: nonEmpty.describe("Selector del campo de contraseña."),
	}),
	submit: nonEmpty
		.optional()
		.describe("Selector del botón de enviar; sin él, se envía el formulario."),
});

const UserSchema = z.strictObject({
	username: nonEmpty,
	secretRef: nonEmpty.describe(
		"Nombre de la contraseña en FCC_WEB_SECRETS_FILE: nunca la contraseña.",
	),
});

export const ProjectSchema = z.strictObject({
	contract: z.literal(CONTRACT.project),
	web: z.strictObject({
		baseUrl: z
			.url()
			.regex(HTTP_URL, "baseUrl es http o https")
			.describe("Raíz de la web: no se navega fuera de ella."),
		viewport: ViewportSchema,
		screenScale: z
			.number()
			.positive()
			.optional()
			.describe(
				"--force-device-scale-factor del Chrome de captura (1 por defecto).",
			),
		devicePixelRatio: z
			.number()
			.positive()
			.optional()
			.describe("deviceScaleFactor que se emula (1 por defecto)."),
		login: LoginSchema.optional(),
		users: z.record(nonEmpty, UserSchema).optional(),
		strip: z
			.array(nonEmpty)
			.optional()
			.describe("Selectores que se quitan antes de capturar."),
		hideScrollbar: z.boolean().optional(),
	}),
	screens: nonEmpty.describe("Ruta al screens@1, relativa a este fichero."),
	hooks: nonEmpty
		.optional()
		.describe("Ruta al módulo de ganchos, relativa a este fichero."),
	areas: nonEmpty
		.optional()
		.describe("Ruta al areas@1, relativa a este fichero."),
	map: nonEmpty.optional().describe("Ruta al map@1, relativa a este fichero."),
	sheets: nonEmpty
		.optional()
		.describe(
			"Ruta al sheets@1 (hojas de componentes), relativa a este fichero.",
		),
	compose: nonEmpty
		.optional()
		.describe(
			"Carpeta de los compose@1 (pantallas diseñadas en Figma sin web previa), relativa a este fichero.",
		),
	recognize: nonEmpty
		.optional()
		.describe(
			"Ruta al módulo recognize@1 (código del proyecto: reglas de reconocimiento), relativa a este fichero.",
		),
}) satisfies z.ZodType<ProjectConfig>; // el tipo del dominio y el esquema no pueden divergir
