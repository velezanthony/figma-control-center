// Contrato del lote (figma_build), fuente única: el manifiesto en disco (adapters/fs), los `steps` escritos a mano
// (adapters/mcp) y los ejemplos de los tests (server/test/contracts/build.ts) usan estos esquemas. Es un contrato
// PROPIO (docs/users/contracts.md), no una salida real.
// Su JSON Schema publicado es schemas/build-manifest.v1.json (un test exige que coincida con `z.toJSONSchema`).
// strictObject: una clave que el contrato no define es un error, no se ignora. Así un typo (`timoutMs` por `timeoutMs`)
// se rechaza en vez de aceptarse descartando el valor del usuario (que es lo que haría z.object en zod v4).
import { z } from "zod";
import { SCRIPT_FORMAT } from "#domain/script-format.ts";
import {
	AREA_KIT_STEPS,
	COMPOSE_KIT_STEP,
	SCREEN_KIT_STEP,
	SHEET_KIT_STEP,
} from "#domain/step.ts";

export const BUILD_MANIFEST_CONTRACT = Object.freeze({
	name: "build-manifest",
	version: 1,
} as const);

// Formatos de un paso: los mismos que figma_run_script; sin `format`, el de figma_run_script
export const BUILD_STEP_FORMATS = [
	SCRIPT_FORMAT.body,
	SCRIPT_FORMAT.function,
] as const;
export const DEFAULT_STEP_FORMAT = SCRIPT_FORMAT.body;

// Un objeto JSON de params: claves string, valores cualesquiera
const jsonRecord = z.record(z.string(), z.unknown());

const FileStepSchema = z.strictObject({
	file: z
		.string()
		.min(1)
		.describe("Ruta del script del paso, dentro de las raíces permitidas."),
	format: z
		.enum(BUILD_STEP_FORMATS)
		.optional()
		.describe(
			"`body` (cuerpo async, por defecto) o `function` (expresión `async () => {…}`).",
		),
	params: jsonRecord
		.optional()
		.describe(
			"Params propios del paso; se mezclan sobre los de la llamada (gana el paso).",
		),
	assets: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Ficheros binarios por nombre → ruta; llegan como Uint8Array en `assets`.",
		),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Plazo del paso en ms; por defecto FCC_BUILD_STEP_TIMEOUT_MS."),
});

// Un paso del kit de área: nombra el paso y el área; sus params salen de areas@1, así que ni `file` ni
// `params`
const timeoutMs = z
	.number()
	.int()
	.positive()
	.optional()
	.describe("Plazo del paso en ms; por defecto FCC_BUILD_STEP_TIMEOUT_MS.");

const AreaUseStepSchema = z.strictObject({
	use: z
		.enum(AREA_KIT_STEPS)
		.describe(
			"Paso del kit: kit/place@1, kit/share@1, kit/links@1, kit/fill-image@1 o kit/layout-check@1.",
		),
	area: z
		.string()
		.min(1)
		.describe("Nombre del área de areas@1 (en la carpeta del proyecto)."),
	timeoutMs,
});

// El paso que pinta una pantalla: `screen` es obligatorio aquí
const ScreenUseStepSchema = z.strictObject({
	use: z
		.literal(SCREEN_KIT_STEP)
		.describe(
			"kit/build-screen@1: pinta una pantalla desde su última captura.",
		),
	screen: z
		.string()
		.min(1)
		.describe(
			"Clave de la pantalla en screens@1 (en la carpeta del proyecto).",
		),
	area: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Área de areas@1 donde se coloca: la pantalla se pinta en su página temporal. Sin ella, en una página propia del kit.",
		),
	variant: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe("Variante de la captura que se pinta (0 por defecto)."),
	capture: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Captura concreta, ruta relativa a web-captures/ (la última válida por defecto).",
		),
	timeoutMs,
});

// El paso que pinta una hoja de componente: `sheet` es obligatorio aquí
const SheetUseStepSchema = z.strictObject({
	use: z
		.literal(SHEET_KIT_STEP)
		.describe(
			"kit/build-component@1: pinta una hoja de componente desde su última captura y sheets@1.",
		),
	sheet: z
		.string()
		.min(1)
		.describe("Clave de la hoja en sheets@1 (en la carpeta del proyecto)."),
	scratch: z
		.boolean()
		.optional()
		.describe(
			"Pinta en una página aparte (`fcc · hoja · <clave>`) en vez de en la de la hoja.",
		),
	timeoutMs,
});

// El paso que pinta un compose@1: `compose` es obligatorio aquí
const ComposeUseStepSchema = z.strictObject({
	use: z
		.literal(COMPOSE_KIT_STEP)
		.describe(
			"kit/compose@1: pinta una pantalla diseñada en Figma sin web previa desde su compose@1.",
		),
	compose: z
		.string()
		.min(1)
		.describe(
			"Clave del compose@1: el fichero `<clave>.json` de la carpeta `compose` del proyecto.",
		),
	timeoutMs,
});

export const ManifestStepSchema = z.union([
	FileStepSchema,
	AreaUseStepSchema,
	ScreenUseStepSchema,
	SheetUseStepSchema,
	ComposeUseStepSchema,
]);

// Lo que el lote exige del archivo abierto: hoy, su nombre
export const ExpectSchema = z.strictObject({
	fileName: z.string().min(1),
});

// El manifiesto completo: nombre opcional, params comunes y al menos un paso
export const ManifestSchema = z.strictObject({
	name: z.string().min(1).optional(),
	expect: ExpectSchema.optional(),
	params: jsonRecord.optional(),
	steps: z.array(ManifestStepSchema).min(1),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestStep = z.infer<typeof ManifestStepSchema>;
