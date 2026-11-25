// Contrato areas@1. Es un contrato PROPIO: su fuente es el esquema zod y docs/users/contracts.md, no una salida real.
// Vive en el servidor (#adapters/contracts/areas.ts, JSON Schema en schemas/areas.v1.json). El ejemplo se CONSTRUYE aquí
// y se valida al construirlo; los nombres son genéricos (la herramienta no conoce ningún proyecto).
import { AreasSchema } from "#adapters/contracts/areas.ts";
import { AREAS_CONTRACT } from "#domain/areas.ts";

export const AREAS_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (areas@1)",
	"schemas/areas.v1.json",
] as const);

export const areasExample = (): unknown =>
	AreasSchema.parse({
		contract: AREAS_CONTRACT,
		linkRules: {
			clickable: {
				names: ["boton", "enlace"],
				namePrefixes: ["Boton /"],
				components: ["Boton"],
				parts: [{ name: "etiqueta", insideComponent: "Pestaña" }],
			},
			rows: { row: ["fila"], body: ["cuerpo"] },
			transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
		},
		areas: [
			{
				name: "Panel",
				page: "Panel",
				frame: { width: 1440, minHeight: 900, fill: "surface", clip: true },
				place: {
					mode: "replace-content",
					source: {
						pagePrefix: "tmp ",
						take: "first-variant",
						remove: true,
					},
					unwrap: { holding: ["raiz"] },
					strokeScale: 0.8,
				},
				shell: {
					set: "Panel / Lateral",
					in: ["lateral", "barra"],
					variantProp: "activa",
					default: "inicio",
					fixed: { height: 900 },
				},
				main: ["principal", "contenido"],
				screens: [
					{ frame: "inicio", screen: "inicio", shell: "inicio" },
					{ frame: "detalle", shell: "detalle" },
				],
				links: [
					{ from: "inicio", text: "Ver detalle", to: "detalle" },
					{ from: "inicio", text: "Ver", match: "start", to: "detalle" },
					{ from: "inicio", rows: true, to: "detalle" },
				],
				flowStart: { frame: "inicio", name: "Panel" },
				fills: [
					{
						frame: "detalle",
						find: { text: "Mapa", minSize: [200, 100] },
						asset: "mapa.png",
						name: "Mapa",
					},
				],
			},
			{
				name: "Portada",
				page: "Portada",
				frame: { width: 1280, minHeight: 800 },
				place: {
					mode: "transplant",
					source: { pagePrefix: "tmp ", take: "first-frame" },
					keep: ["Cabecera", "Pie"],
					drop: ["Cabecera", "Pie"],
				},
				screens: [{ frame: "portada" }],
			},
		],
		shared: [
			{
				name: "Perfil",
				set: "Perfil / Contenido",
				page: { name: "Compartido", after: "Panel" },
				part: ["perfil"],
				variantProp: "area",
				from: [{ area: "Panel", frame: "detalle", value: "panel" }],
				sheet: { gap: 40, padding: 40 },
			},
		],
	});
