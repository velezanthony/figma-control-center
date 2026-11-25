// Contrato design-context@1. Es un contrato PROPIO: su fuente es el esquema zod y docs/users/contracts.md, no una salida real.
// Vive en el servidor (#adapters/contracts/design-context.ts, JSON Schema en schemas/design-context.v1.json). El ejemplo se
// CONSTRUYE aquí y se valida al construirlo; los nombres son genéricos (la herramienta no conoce ningún proyecto).
import { DesignContextSchema } from "#adapters/contracts/design-context.ts";
import { DESIGN_CONTEXT_CONTRACT } from "#domain/design-context.ts";

export const DESIGN_CONTEXT_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (design-context@1)",
	"schemas/design-context.v1.json",
] as const);

const px = (value: number) => ({ raw: value });

export const designContextExample = (): unknown =>
	DesignContextSchema.parse({
		contract: DESIGN_CONTEXT_CONTRACT,
		file: { key: "abc123", name: "Archivo de ejemplo" },
		readAt: "2026-11-15T10:20:30.000Z",
		root: "10:1",
		origin: { kind: "area", key: "inicio/portada" },
		nodes: [
			{
				id: "10:1",
				parent: null,
				name: "Portada",
				type: "FRAME",
				visible: true,
				box: { x: 0, y: 0, w: 320, h: 200 },
				layout: {
					mode: "VERTICAL",
					wrap: false,
					gap: { variable: "VariableID:1:2" },
					padding: [px(16), px(16), px(16), px(16)],
					primaryAlign: "MIN",
					counterAlign: "MIN",
				},
				placement: {
					sizing: { h: "FILL", v: "HUG" },
					min: { w: 280 },
				},
				fills: [{ variable: "VariableID:1:1" }],
				strokes: [{ raw: { type: "SOLID" } }],
				strokeWeight: px(1),
				radius: {
					tl: { variable: "VariableID:1:3" },
					tr: { variable: "VariableID:1:3" },
					br: { variable: "VariableID:1:3" },
					bl: { variable: "VariableID:1:3" },
				},
				opacity: 1,
				hints: { classes: ["bg-brand-500"], unmapped: ["strokes"] },
			},
			{
				id: "10:2",
				parent: "10:1",
				name: "Título",
				type: "TEXT",
				visible: true,
				box: { x: 16, y: 16, w: 288, h: 28 },
				text: {
					characters: "Hola",
					font: {
						family: "Inter",
						style: "Bold",
						size: 20,
						lineHeight: { unit: "PIXELS", value: 28 },
						letterSpacing: { unit: "PERCENT", value: 0 },
					},
					style: "S:titulo,",
				},
				fills: [{ style: "S:titulo-color," }],
			},
			{
				id: "10:3",
				parent: "10:1",
				name: "Botón principal",
				type: "INSTANCE",
				visible: true,
				box: { x: 16, y: 52, w: 96, h: 40 },
				instance: {
					component: "k-boton",
					variant: { Tamaño: "M", Tipo: "Primario" },
					props: { Texto: "Aceptar", "Mostrar icono": false },
					overridden: ["characters"],
				},
				matched: { by: "rule:boton" },
			},
		],
		variables: {
			"VariableID:1:1": {
				name: "brand/500",
				collection: "Tokens",
				type: "COLOR",
				value: { r: 1, g: 0.4, b: 0, a: 1 },
				aliasOf: ["color/primario"],
				codeClass: "brand-500",
			},
			"VariableID:1:2": {
				name: "spacing/4",
				collection: "Tokens",
				type: "FLOAT",
				value: 16,
			},
			"VariableID:1:3": {
				name: "radius/md",
				collection: "Tokens",
				type: "FLOAT",
				value: 8,
			},
		},
		styles: {
			"S:titulo,": {
				name: "Título/L",
				kind: "text",
				key: "titulo",
				value: { fontName: { family: "Inter", style: "Bold" }, fontSize: 20 },
			},
			"S:titulo-color,": {
				name: "Título/Color",
				kind: "paint",
				key: "titulo-color",
				value: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
			},
		},
		components: {
			"k-boton": {
				name: "Botón",
				kind: "COMPONENT_SET",
				key: "k-boton",
				remote: false,
				variants: { Tamaño: ["S", "M"], Tipo: ["Primario", "Secundario"] },
				properties: [
					{ name: "Texto", type: "TEXT", default: "Aceptar" },
					{ name: "Mostrar icono", type: "BOOLEAN", default: false },
					{ name: "Hueco", type: "SLOT", default: null },
				],
				sheet: "button",
				code: {
					source: "src/components/button.html",
					tag: "<ui-button>",
					by: "name",
				},
			},
			"k-tarjeta": {
				name: "Tarjeta",
				kind: "COMPONENT",
				key: "k-tarjeta",
				remote: true,
				library: "Librería externa",
				variants: {},
				properties: [],
				candidates: ["card", "card-compact"],
			},
		},
		truncated: { reason: "max-nodes", children: ["10:9"] },
		warnings: [
			{
				code: "NO_CODE_MAPPING",
				message: "El set «Tarjeta» no tiene hoja",
				component: "k-tarjeta",
			},
		],
	});
