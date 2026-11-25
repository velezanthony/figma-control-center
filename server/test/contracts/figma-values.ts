// Contrato de los valores de Figma que devuelven nuestros scripts internos (estado, metadatos, exportación PNG).
// Fuente: @figma/plugin-typings (node_modules/@figma/plugin-typings/plugin-api.d.ts):
//  - `BaseNode['type']` define los tipos de nodo (aquí se leen del propio .d.ts con el compilador de TypeScript);
//  - `BaseNodeMixin.id: string`, `.name: string`; `figma.root.name`, `figma.currentPage.name`;
//  - `exportAsync(settings?): Promise<Uint8Array>` y `figma.base64Encode(data: Uint8Array): string`.
//  - lecturas del catálogo (M3): `Variable` (id, name, resolvedType: VariableResolvedDataType, scopes: VariableScope[],
//    description, valuesByMode), `VariableCollection` (modes { modeId, name }, defaultModeId), `VariableValue` y
//    `VariableAlias` ({ type: 'VARIABLE_ALIAS', id }), `PaintStyle.paints`, `TextStyle` (fontName, fontSize…),
//    `EffectStyle.effects`, `GridStyle.layoutGrids`, `ComponentPropertyDefinitions` (type: ComponentPropertyType,
//    defaultValue, variantOptions; un SLOT llega sin defaultValue en el archivo de pruebas y el script lo deja en null) y los formatos de `exportAsync` (ExportSettings: PNG, JPG, SVG, PDF).
// Y la especificación PNG (RFC 2083: firma de 8 bytes y chunk IHDR con ancho y alto en big-endian); la firma de JPEG
// (ISO/IEC 10918-1: SOI FF D8 FF), la de PDF (ISO 32000: «%PDF-») y la raíz `<svg` de SVG (W3C SVG 1.1).

import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import ts from "typescript";
import { z } from "zod";
import { DesignReadSchema } from "#adapters/contracts/design-context.ts";

export const FIGMA_CONTRACT_SOURCES = Object.freeze([
	"@figma/plugin-typings (plugin-api.d.ts)",
	"https://www.rfc-editor.org/rfc/rfc2083 (PNG)",
	"ISO/IEC 10918-1 (JPEG, marcador SOI)",
	"ISO 32000 (PDF, cabecera %PDF-)",
	"https://www.w3.org/TR/SVG11/ (SVG)",
] as const);

const require = createRequire(import.meta.url);

// Los literales de un alias de tipo del .d.ts (`NodeType`, `VariableScope`…): si Figma añade un valor, el contrato lo
// sabe al actualizar el paquete
function readStringUnion(name: string): readonly string[] {
	const file = require.resolve("@figma/plugin-typings/plugin-api.d.ts");
	const program = ts.createProgram([file], {
		noLib: true,
		skipLibCheck: true,
		types: [],
	});
	const checker = program.getTypeChecker();
	const source = program.getSourceFile(file);
	const alias = source?.statements.find(
		(s): s is ts.TypeAliasDeclaration =>
			ts.isTypeAliasDeclaration(s) && s.name.text === name,
	);
	if (alias === undefined)
		throw new Error(`${name} no está en plugin-api.d.ts`);
	const type = checker.getTypeAtLocation(alias.name);
	const members = type.isUnion() ? type.types : [type];
	const names = members.flatMap((t) => (t.isStringLiteral() ? [t.value] : []));
	if (names.length === 0) throw new Error(`${name} no se resolvió a literales`);
	return names;
}

export const NODE_TYPES = readStringUnion("NodeType");

// Id de nodo: «página:índice»; las instancias anidan ids con «;» y se prefijan con «I»
export const NODE_ID = /^I?\d+:\d+(?:;\d+:\d+)*$/;
export const NodeIdSchema = z.string().regex(NODE_ID);
export const NodeTypeSchema = z.string().refine((t) => NODE_TYPES.includes(t), {
	message: "no es un NodeType de @figma/plugin-typings",
});

export type MetadataNode = {
	id: string;
	name: string;
	type: string;
	children?: MetadataNode[] | undefined;
};
export const MetadataNodeSchema: z.ZodType<MetadataNode> = z.lazy(() =>
	z.strictObject({
		id: NodeIdSchema,
		name: z.string(),
		type: NodeTypeSchema,
		children: z.array(MetadataNodeSchema).optional(),
	}),
);

export const StatusValueSchema = z.strictObject({
	file: z.string(),
	page: z.string(),
});

// Diagnóstico de acceso que evalúa figma_status (adapters/cdp/protocol.ts, FIGMA_ACCESS_EXPRESSION). Fuente: el
// global `figma` (@figma/plugin-typings) y `window.INITIAL_OPTIONS` de figma.com (`user_data`,
// `editing_file.can_edit`), mirado en vivo en una pestaña de solo lectura; «sin sesión» NO VERIFICADO en vivo.
export const ACCESS_VALUES = [
	"ready",
	"loading",
	"notLoggedIn",
	"viewOnly",
] as const;
export const AccessValueSchema = z.enum(ACCESS_VALUES);
export type AccessValue = z.infer<typeof AccessValueSchema>;

// Lo que la sonda `access-state` lee de la pestaña (solo nombres y booleanos, nunca valores del usuario): sirve para
// contrastar con Figma real las heurísticas de figma_status (FIGMA_ACCESS_EXPRESSION). Fuente: window.INITIAL_OPTIONS
// y location de figma.com; qué trae cada estado (sin sesión, solo lectura, cargando) lo mide el dueño con `make e2e-record`.
export const AccessStateSchema = z.strictObject({
	figmaType: z.string(),
	firstPathSegment: z.string().nullable(),
	readyState: z.string(),
	hasInitialOptions: z.boolean(),
	hasUserData: z.boolean(),
	canEdit: z.boolean().nullable(),
	initialOptionsKeys: z.array(z.string()),
	userDataKeys: z.array(z.string()),
});
export type AccessState = z.infer<typeof AccessStateSchema>;
export const accessState = (state: AccessState) =>
	AccessStateSchema.parse(state);

// Convención propia de los scripts de escritura: `return { createdNodeIds?, mutatedNodeIds?, …datos }`
export const WriteResultSchema = z.looseObject({
	createdNodeIds: z.array(NodeIdSchema).optional(),
	mutatedNodeIds: z.array(NodeIdSchema).optional(),
});

export const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

export const pngDimensions = (
	png: Buffer,
): { readonly width: number; readonly height: number } | null =>
	png.length >= 24 &&
	png.subarray(0, 8).equals(PNG_SIGNATURE) &&
	png.subarray(12, 16).toString("latin1") === "IHDR"
		? {
				width: png.readUInt32BE(IHDR_WIDTH_OFFSET),
				height: png.readUInt32BE(IHDR_HEIGHT_OFFSET),
			}
		: null;

// Lo que devuelve el script de captura: `figma.base64Encode(bytes)` de un PNG
export const ExportValueSchema = z.strictObject({
	base64: z
		.string()
		.refine((b64) => pngDimensions(Buffer.from(b64, "base64")) !== null, {
			message: "no es un PNG (firma + IHDR)",
		}),
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
	let c = 0xffffffff;
	for (const byte of buf)
		c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, "latin1");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
};

// PNG RGB real, de un solo color, con las dimensiones pedidas (RFC 2083)
export function buildPng(
	width: number,
	height: number,
	rgb: readonly [number, number, number] = [255, 102, 0],
): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const row = Buffer.concat([
		Buffer.from([0]),
		Buffer.from(Array.from({ length: width }, () => rgb).flat()),
	]);
	const raw = Buffer.concat(Array.from({ length: height }, () => row));
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

export const exportValue = (png: Buffer) =>
	ExportValueSchema.parse({ base64: png.toString("base64") });
export const metadataValue = (tree: MetadataNode) =>
	MetadataNodeSchema.parse(tree);
export const accessValue = (access: AccessValue) =>
	AccessValueSchema.parse(access);
export const statusValue = (file: string, page: string) =>
	StatusValueSchema.parse({ file, page });

// --- Lecturas del catálogo (M3): lo que devuelven los scripts internos de adapters/cdp/scripts/ ---

export const VARIABLE_RESOLVED_TYPES = readStringUnion(
	"VariableResolvedDataType",
);
export const VARIABLE_SCOPES = readStringUnion("VariableScope");
export const COMPONENT_PROPERTY_TYPES = readStringUnion(
	"ComponentPropertyType",
);
const fromTypings = (values: readonly string[], label: string) =>
	z.string().refine((v) => values.includes(v), {
		message: `no es un ${label} de @figma/plugin-typings`,
	});

const channel = z.number().min(0).max(1);
const ColorSchema = z.strictObject({
	r: channel,
	g: channel,
	b: channel,
	a: channel.optional(),
});
// Nuestro alias resuelto a un nivel: el nombre es null si la variable es remota y no se conoce
const AliasValueSchema = z.strictObject({
	alias: z.strictObject({ id: z.string().min(1), name: z.string().nullable() }),
});
// MotionEasing y VariableComposedColor de VariableValue: objetos que se dejan tal cual, pero nunca el alias crudo
const ComposedValueSchema = z
	.looseObject({})
	.refine((v) => v["type"] !== "VARIABLE_ALIAS", {
		message: "un VariableAlias crudo: el script debe resolverlo a { alias }",
	});
const VariableModeValueSchema = z.union([
	z.boolean(),
	z.number(),
	z.string(),
	ColorSchema,
	AliasValueSchema,
	ComposedValueSchema,
]);

const VariableSchema = z.strictObject({
	id: z.string().min(1),
	name: z.string(),
	resolvedType: fromTypings(
		VARIABLE_RESOLVED_TYPES,
		"VariableResolvedDataType",
	),
	scopes: z.array(fromTypings(VARIABLE_SCOPES, "VariableScope")),
	description: z.string(),
	valuesByMode: z.record(z.string(), VariableModeValueSchema),
});

const CollectionSchema = z.strictObject({
	id: z.string().min(1),
	name: z.string(),
	modes: z.array(z.strictObject({ id: z.string().min(1), name: z.string() })),
	defaultModeId: z.string().min(1),
	variables: z.array(VariableSchema),
});

export const VariablesValueSchema = z.strictObject({
	collections: z.array(CollectionSchema),
	bindings: z
		.array(
			z.strictObject({
				nodeId: NodeIdSchema,
				field: z.string().min(1),
				variableId: z.string().min(1),
			}),
		)
		.optional(),
});
export type VariablesValue = z.infer<typeof VariablesValueSchema>;

// `value` corto según el tipo: pinturas (Paint[]), tipografía de TextStyle, efectos (Effect[]) o retículas (LayoutGrid[])
const typed = z.looseObject({ type: z.string() });
const StyleBase = {
	id: z.string().min(1),
	key: z.string(),
	name: z.string(),
	description: z.string(),
	boundVariables: z.record(z.string(), z.unknown()),
};
const StyleSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		...StyleBase,
		kind: z.literal("paint"),
		value: z.array(typed),
	}),
	z.strictObject({
		...StyleBase,
		kind: z.literal("text"),
		value: z.looseObject({
			fontName: z.strictObject({ family: z.string(), style: z.string() }),
			fontSize: z.number(),
		}),
	}),
	z.strictObject({
		...StyleBase,
		kind: z.literal("effect"),
		value: z.array(typed),
	}),
	z.strictObject({
		...StyleBase,
		kind: z.literal("grid"),
		value: z.array(z.looseObject({ pattern: z.string() })),
	}),
]);
export const StylesValueSchema = z.strictObject({
	styles: z.array(StyleSchema),
});
export type StylesValue = z.infer<typeof StylesValueSchema>;

export const ComponentsValueSchema = z.strictObject({
	components: z.array(
		z.strictObject({
			id: NodeIdSchema,
			key: z.string(),
			name: z.string(),
			type: z.enum(["COMPONENT_SET", "COMPONENT"]),
			page: z.string(),
			pageIndex: z.number().int().min(0),
			description: z.string(),
			variants: z.record(z.string(), z.array(z.string())),
			properties: z.array(
				z
					.strictObject({
						name: z.string(),
						type: fromTypings(
							COMPONENT_PROPERTY_TYPES,
							"ComponentPropertyType",
						),
						defaultValue: z.union([z.string(), z.boolean(), z.null()]),
					})
					// Figma no da `defaultValue` en un SLOT (el script lo deja en null); el resto siempre lo lleva
					.refine((p) => (p.type === "SLOT") === (p.defaultValue === null), {
						path: ["defaultValue"],
						message: "defaultValue es null solo en un SLOT",
					}),
			),
			variantCount: z.number().int().min(0),
		}),
	),
});
export type ComponentsValue = z.infer<typeof ComponentsValueSchema>;

export const InstancesValueSchema = z.strictObject({
	frames: z.array(
		z.strictObject({
			page: z.string(),
			frameId: NodeIdSchema,
			frameName: z.string(),
			counts: z.record(z.string(), z.number().int().min(0)),
		}),
	),
});
export type InstancesValue = z.infer<typeof InstancesValueSchema>;

// Firma de los bytes de exportAsync por formato
const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_HEADER = "%PDF-";
const SVG_ROOT = /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/;
export const EXPORT_SIGNATURE = Object.freeze({
	PNG: (b: Buffer) => pngDimensions(b) !== null,
	JPG: (b: Buffer) => b.subarray(0, 3).equals(JPEG_SOI),
	SVG: (b: Buffer) => SVG_ROOT.test(b.toString("utf8")),
	PDF: (b: Buffer) => b.subarray(0, 5).toString("latin1") === PDF_HEADER,
} as const);
export type ExportFormatValue = keyof typeof EXPORT_SIGNATURE;

// Lo que devuelve el script de exportación: un `figma.base64Encode(bytes)` por nodo, en el orden pedido
export const exportNodesSchema = (format: ExportFormatValue) =>
	z.strictObject({
		nodes: z.array(
			z.strictObject({
				nodeId: NodeIdSchema,
				base64: z
					.string()
					.refine(
						(b64) => EXPORT_SIGNATURE[format](Buffer.from(b64, "base64")),
						{
							message: `no lleva la firma de ${format}`,
						},
					),
			}),
		),
	});

// JPEG mínimo: SOI, APP0 (JFIF) y EOI. Basta para la firma (el contrato no decodifica la imagen)
export const buildJpg = (): Buffer =>
	Buffer.concat([
		JPEG_SOI,
		Buffer.from([0xe0, 0x00, 0x10]),
		Buffer.from("JFIF\0", "latin1"),
		Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
		Buffer.from([0xff, 0xd9]),
	]);
export const buildSvg = (width: number, height: number): Buffer =>
	Buffer.from(
		`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="#FF6600"/></svg>`,
		"utf8",
	);
export const buildPdf = (): Buffer =>
	Buffer.from(
		"%PDF-1.4\n%\xE2\xE3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
		"latin1",
	);

export const variablesValue = (value: VariablesValue) =>
	VariablesValueSchema.parse(value);
export const stylesValue = (value: StylesValue) =>
	StylesValueSchema.parse(value);
export const componentsValue = (value: ComponentsValue) =>
	ComponentsValueSchema.parse(value);
export const instancesValue = (value: InstancesValue) =>
	InstancesValueSchema.parse(value);
// figma_design_context: lo que devuelve el script de la pestaña, con el contrato de producción
export type DesignReadValue = z.infer<typeof DesignReadSchema>;
export const designReadValue = (value: DesignReadValue) =>
	DesignReadSchema.parse(value);
export const exportNodesValue = (
	format: ExportFormatValue,
	nodes: readonly { readonly nodeId: string; readonly bytes: Buffer }[],
) =>
	exportNodesSchema(format).parse({
		nodes: nodes.map((n) => ({
			nodeId: n.nodeId,
			base64: n.bytes.toString("base64"),
		})),
	});
