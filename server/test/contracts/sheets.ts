// Contrato sheets@1 (hojas de componentes). Es un contrato PROPIO: su fuente es el esquema zod y docs/users/contracts.md, no una salida real.
// Vive en el servidor (#adapters/contracts/sheets.ts, JSON Schema en schemas/sheets.v1.json). El ejemplo se CONSTRUYE aquí
// y se valida al construirlo; los nombres son genéricos (la herramienta no conoce ningún proyecto).
import { SheetsSchema } from "#adapters/contracts/sheets.ts";
import { SHEETS_CONTRACT } from "#domain/sheets.ts";

export const SHEETS_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (sheets@1)",
	"schemas/sheets.v1.json",
] as const);

export const sheetsExample = (): unknown =>
	SheetsSchema.parse({
		contract: SHEETS_CONTRACT,
		style: {
			header: { fill: "brand/50", text: "brand/600" },
			card: { fill: "white" },
			texts: {
				description: "text/secondary",
				bug: "danger/600",
				tag: "text/primary",
				rowLabel: "text/secondary",
				colLabel: "text/muted",
			},
			bug: { prefix: "Fallo conocido: ", setPrefix: "FALLO CONOCIDO: " },
			matrix: { stroke: "border" },
		},
		sections: { Atomos: { default: true }, Moleculas: {} },
		sheets: [
			{
				key: "button",
				screen: "cmp-button",
				title: "Button",
				page: { name: "   Button", after: "   Badge", section: "Atomos" },
				description: "Botón con variantes",
				bug: "el estado cargando no gira",
				tag: "<ui-button>",
				matrix: { rows: ["variant"], align: "top" },
				texts: [{ name: "contenido", match: "Botón" }],
				booleans: [{ name: "Mostrar punto", layer: "dot", on: true }],
				icons: [
					{
						icon: "plus",
						boolean: "Mostrar icono",
						swap: "Icono",
						on: false,
						noBooleanWhen: { variant: "icon" },
					},
				],
				slots: [{ name: "Hueco", layer: "slot", boolean: "Mostrar hueco" }],
				names: [{ classes: "^avatar$", name: "Avatar" }],
				exposed: ["Flag"],
				flowIcons: true,
				rules: ["Badge"],
				keep: ["etiqueta"],
			},
			{
				key: "badge",
				screen: "cmp-badge",
				title: "Badge",
				page: { name: "   Badge" },
				description: "Etiqueta",
				drift: {
					decision: "map",
					values: { card: "no" },
					fingerprint: {
						variantProps: { card: ["no", "title"], size: ["lg", "sm"] },
						variants: ["card=no, size=sm", "card=title, size=sm"],
						properties: ["contenido"],
						layers: [],
					},
				},
			},
		],
	});
