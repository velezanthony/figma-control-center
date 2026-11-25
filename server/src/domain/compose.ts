// compose@1: una pantalla o un componente nuevo que se diseña en Figma sin web previa,
// como datos. Solo piezas del sistema: instancias de hojas, variables y estilos, nunca un número ni un color sueltos.
// Tipos puros, sin imports: el esquema zod que los valida en el borde vive en adapters/contracts/compose.ts y se
// comprueba contra estos tipos al compilar. Las reglas que el esquema no ve (la hoja existe, el token existe…) las
// comprueba domain/compose-check.ts.

export const COMPOSE_CONTRACT = "compose@1";

// Clave con la que el kit etiqueta el frame de un compose (el kit repite este prefijo y un test los cruza)
export const COMPOSE_KEY_PREFIX = "fcc:compose:";

// Clave de la página que el kit crea para un compose cuya página no existía (una que ya existía no se etiqueta)
export const COMPOSE_PAGE_KEY_PREFIX = "fcc:compose-page:";

// La clave de un compose da nombre a su fichero (`<clave>.json`) y a su frame: sin barras, espacios ni puntos
export const COMPOSE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const composePageKey = (compose: string): string =>
	`${COMPOSE_PAGE_KEY_PREFIX}${compose}`;

export const composeKey = (compose: string): string =>
	`${COMPOSE_KEY_PREFIX}${compose}`;

export const STACK_DIRECTION = Object.freeze({
	vertical: "VERTICAL",
	horizontal: "HORIZONTAL",
	grid: "GRID",
} as const);
export type StackDirection =
	(typeof STACK_DIRECTION)[keyof typeof STACK_DIRECTION];

export const COMPOSE_SIZING = ["FIXED", "HUG", "FILL"] as const;
export type ComposeSizing = (typeof COMPOSE_SIZING)[number];

export const IMAGE_FIT = ["fill", "fit", "crop", "tile"] as const;
export type ImageFit = (typeof IMAGE_FIT)[number];

// El nombre de una variable (p. ej. «spacing/4», «brand/500») o de un estilo: nunca un número ni un color suelto
export type ComposeToken = string;

export type StackBlock = {
	readonly stack: StackDirection;
	readonly gap?: ComposeToken | undefined;
	readonly padding?: ComposeToken | readonly ComposeToken[] | undefined;
	readonly fill?: ComposeToken | undefined;
	readonly radius?: ComposeToken | undefined;
	readonly sizing?:
		| { readonly h: ComposeSizing; readonly v: ComposeSizing }
		| undefined;
	readonly name?: string | undefined;
	readonly children: readonly ComposeBlock[];
};

export type UseBlock = {
	// La clave de una hoja de sheets@1; `{ key }` (una pieza de librería) queda fuera del MVP
	readonly use: string | { readonly key: string };
	readonly variant?: Readonly<Record<string, string>> | undefined;
	readonly props?: Readonly<Record<string, string | boolean>> | undefined;
	readonly slots?:
		| Readonly<Record<string, readonly ComposeBlock[]>>
		| undefined;
	readonly name?: string | undefined;
};

export type TextBlock = {
	readonly text: string;
	// Un estilo de texto
	readonly style: ComposeToken;
	readonly color?: ComposeToken | undefined;
	readonly name?: string | undefined;
};

export type ImageBlock = {
	// Ruta en la carpeta del proyecto
	readonly image: string;
	readonly fit?: ImageFit | undefined;
	readonly name?: string | undefined;
};

export type IconBlock = {
	// Un nombre del catálogo de iconos de map@1
	readonly icon: string;
	readonly color?: ComposeToken | undefined;
};

export type ComposeBlock =
	| StackBlock
	| UseBlock
	| TextBlock
	| ImageBlock
	| IconBlock;

export type ComposeTarget = {
	readonly page: string;
	readonly frame?: string | undefined;
	readonly width: number;
	readonly height?: number | undefined;
};

export type ComposeFile = {
	readonly contract: typeof COMPOSE_CONTRACT;
	readonly key: string;
	readonly title: string;
	readonly target: ComposeTarget;
	readonly root: ComposeBlock;
};
