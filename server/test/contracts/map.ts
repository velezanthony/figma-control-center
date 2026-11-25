// Contrato map@1 (el mapa código → Figma como datos). Es un contrato PROPIO: su fuente es el esquema zod y docs/users/contracts.md, no una salida real.
// Vive en el servidor (#adapters/contracts/map.ts, JSON Schema en schemas/map.v1.json). El ejemplo se CONSTRUYE aquí y se
// valida al construirlo; los nombres son genéricos (la herramienta no conoce ningún proyecto).
import { MapSchema } from "#adapters/contracts/map.ts";
import { MAP_CONTRACT } from "#domain/map.ts";

export const MAP_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (map@1)",
	"schemas/map.v1.json",
] as const);

export const mapExample = (): unknown =>
	MapSchema.parse({
		contract: MAP_CONTRACT,
		tokens: {
			collections: ["Base", "Semanticos"],
			classPrefixes: { fill: ["bg-"], text: ["text-"], stroke: ["border-"] },
			classToVariable: [
				{ from: "^text-(.+)$", to: "text/$1" },
				{ from: "^([a-z]+)-(\\d+)$", to: "$1/$2" },
			],
			fallback: { collection: "Base" },
			numbers: {
				radius: { prefix: "radius/", full: "radius/full" },
				spacing: { prefix: "spacing/" },
			},
		},
		fonts: {
			families: [{ match: "mono|courier", family: "Fuente Mono" }],
			default: "Fuente Sans",
			styles: { "400": "Regular", "600": "SemiBold" },
			italic: { suffix: "Italic" },
			strict: ["Fuente Mono"],
			fallback: "Inter",
		},
		effects: { classPattern: "^shadow(-\\w+)?$" },
		icons: {
			pages: "Icon(o)?s",
			prefix: "icons/",
			catalog: "icons.json",
		},
		layers: {
			roles: { p: "párrafo", a: "enlace", button: "botón" },
			textPrefix: true,
		},
		screen: { background: "gray/50" },
	});
