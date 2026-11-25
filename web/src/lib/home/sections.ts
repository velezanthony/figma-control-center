import { ROUTE_LABEL, ROUTE_NAME, type RouteName } from "#web/lib/route.ts";
import type { IconName } from "#web/lib/ui/icons/icons.ts";

export type Section = {
	readonly route: RouteName;
	readonly title: string;
	readonly description: string;
	readonly icon: IconName;
};

// Para qué sirve cada pantalla del panel (el inicio no se lista a sí mismo)
export const SECTIONS: readonly Section[] = [
	{
		route: ROUTE_NAME.activity,
		title: ROUTE_LABEL[ROUTE_NAME.activity],
		description:
			"Cada llamada de Claude a Figma, con su resultado, duración y nodos tocados. Se actualiza en directo.",
		icon: "squares-2x2",
	},
	{
		route: ROUTE_NAME.jobs,
		title: ROUTE_LABEL[ROUTE_NAME.jobs],
		description:
			"Scripts largos que siguieron ejecutándose en Figma tras el plazo blando, y cómo terminaron.",
		icon: "clock",
	},
	{
		route: ROUTE_NAME.captures,
		title: ROUTE_LABEL[ROUTE_NAME.captures],
		description:
			"Las imágenes de nodos que Claude ha pedido, para ver lo que él vio.",
		icon: "photo",
	},
	{
		route: ROUTE_NAME.attempts,
		title: ROUTE_LABEL[ROUTE_NAME.attempts],
		description:
			"Cada vez que se ejecutó un script, un paso de lote o una captura, y qué cambió entre un intento y otro, línea a línea.",
		icon: "arrow-path",
	},
	{
		route: ROUTE_NAME.chat,
		title: ROUTE_LABEL[ROUTE_NAME.chat],
		description:
			"Escribe a la sesión de Claude Code que trabaja en el proyecto y recibe su respuesta aquí.",
		icon: "chat-bubble-left-right",
	},
	{
		route: ROUTE_NAME.projects,
		title: ROUTE_LABEL[ROUTE_NAME.projects],
		description:
			"Da de alta los proyectos de Figma y elige con el selector cuál ves en todo el panel.",
		icon: "server-stack",
	},
	{
		route: ROUTE_NAME.settings,
		title: ROUTE_LABEL[ROUTE_NAME.settings],
		description:
			"Cambia los ajustes de esta máquina (plazos, topes, sondeos) sin tocar el .env, y ve cuándo se aplica cada uno.",
		icon: "adjustments-horizontal",
	},
	{
		route: ROUTE_NAME.components,
		title: ROUTE_LABEL[ROUTE_NAME.components],
		description:
			"La galería de componentes del propio panel, con sus variantes y estados.",
		icon: "swatch",
	},
];
