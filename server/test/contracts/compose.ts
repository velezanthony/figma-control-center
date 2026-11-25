// Contrato compose@1. Es un contrato PROPIO: su fuente es el esquema zod y docs/users/contracts.md, no una salida real.
// Vive en el servidor (#adapters/contracts/compose.ts, JSON Schema en schemas/compose.v1.json). El ejemplo se CONSTRUYE
// aquí y se valida al construirlo; los nombres son genéricos (la herramienta no conoce ningún proyecto).
import { ComposeSchema } from "#adapters/contracts/compose.ts";
import { COMPOSE_CONTRACT } from "#domain/compose.ts";

export const COMPOSE_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (compose@1)",
	"schemas/compose.v1.json",
] as const);

export const composeExample = (): unknown =>
	ComposeSchema.parse({
		contract: COMPOSE_CONTRACT,
		key: "alta-formulario",
		title: "Alta de un contacto",
		target: { page: "Pruebas", frame: "Alta", width: 640, height: 480 },
		root: {
			stack: "VERTICAL",
			gap: "spacing/4",
			padding: ["spacing/6", "spacing/4"],
			fill: "surface",
			radius: "radius/md",
			sizing: { h: "FILL", v: "HUG" },
			name: "Formulario",
			children: [
				{ text: "Alta", style: "Título/L", color: "text/primary" },
				{
					use: "field-group",
					variant: { tamano: "md" },
					props: { etiqueta: "Nombre", requerido: true },
					slots: { ayuda: [{ text: "Como en el DNI", style: "Texto/S" }] },
					name: "Campo nombre",
				},
				{ icon: "check", color: "brand/500" },
				{ image: "assets/portada.png", fit: "fill", name: "Portada" },
				{
					stack: "HORIZONTAL",
					children: [{ use: { key: "k-externa" } }, { use: "button" }],
				},
			],
		},
	});
