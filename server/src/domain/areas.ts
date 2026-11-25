// areas@1: las áreas de un proyecto en Figma, solo datos. Tipos puros, sin imports: el esquema zod que
// los valida en el borde vive en adapters/contracts/areas.ts y se comprueba contra estos tipos al compilar.

export const AREAS_CONTRACT = "areas@1";

// Claves con las que el kit etiqueta lo que crea (`<contrato>:<área>/<pantalla>`). El kit repite
// estos prefijos (no puede importar el servidor) y un test los cruza
export const AREA_KEY_PREFIX = "fcc:area:";
export const SHARED_KEY_PREFIX = "fcc:shared:";

export const areaFrameKey = (area: string, frame: string): string =>
	`${AREA_KEY_PREFIX}${area}/${frame}`;
export const sharedGroupKey = (name: string): string =>
	`${SHARED_KEY_PREFIX}${name}`;

export const PLACE_MODE = Object.freeze({
	replaceContent: "replace-content",
	transplant: "transplant",
} as const);
export type PlaceMode = (typeof PLACE_MODE)[keyof typeof PLACE_MODE];

export const SOURCE_TAKE = Object.freeze({
	firstVariant: "first-variant",
	firstComponent: "first-component",
	firstFrame: "first-frame",
} as const);
export type SourceTake = (typeof SOURCE_TAKE)[keyof typeof SOURCE_TAKE];

export const LINK_MATCH = Object.freeze({
	exact: "exact",
	start: "start",
	contains: "contains",
} as const);
export type LinkMatch = (typeof LINK_MATCH)[keyof typeof LINK_MATCH];

export const TRANSITION_TYPE = Object.freeze({
	dissolve: "DISSOLVE",
	instant: "INSTANT",
	smartAnimate: "SMART_ANIMATE",
} as const);
export type TransitionType =
	(typeof TRANSITION_TYPE)[keyof typeof TRANSITION_TYPE];

export const TRANSITION_EASING = Object.freeze({
	easeOut: "EASE_OUT",
	easeIn: "EASE_IN",
	easeInAndOut: "EASE_IN_AND_OUT",
	linear: "LINEAR",
} as const);
export type TransitionEasing =
	(typeof TRANSITION_EASING)[keyof typeof TRANSITION_EASING];

// Qué nodos son pulsables al buscar un texto: por nombre, por prefijo del nombre o por componente; `parts` son piezas de
// un componente (p. ej. la etiqueta de una pestaña) que también valen
export type Clickable = {
	readonly names: readonly string[];
	readonly namePrefixes: readonly string[];
	readonly components: readonly string[];
	readonly parts?:
		| readonly {
				readonly name: string;
				readonly insideComponent: string;
		  }[]
		| undefined;
};

export type LinkRules = {
	readonly clickable: Clickable;
	// Nombres de capa de una fila de tabla y del cuerpo que la contiene
	readonly rows: {
		readonly row: readonly string[];
		readonly body: readonly string[];
	};
	readonly transition: {
		readonly type: TransitionType;
		readonly easing: TransitionEasing;
		readonly duration: number;
	};
};

export type TextLink = {
	readonly from: string;
	readonly text: string;
	readonly match?: LinkMatch | undefined;
	readonly to: string;
};
export type RowsLink = {
	readonly from: string;
	readonly rows: true;
	readonly to: string;
};
export type Link = TextLink | RowsLink;

export type AreaFrameShape = {
	readonly width: number;
	readonly minHeight: number;
	// Variable de color del relleno por defecto del frame
	readonly fill?: string | undefined;
	readonly clip?: boolean | undefined;
};

export type PlaceSpec = {
	readonly mode: PlaceMode;
	readonly source: {
		readonly pagePrefix: string;
		readonly take: SourceTake;
		readonly remove?: boolean | undefined;
	};
	readonly unwrap?: { readonly holding: readonly string[] } | undefined;
	readonly keep?: readonly string[] | undefined;
	readonly drop?: readonly string[] | undefined;
	readonly strokeScale?: number | undefined;
};

export type ShellSpec = {
	readonly set: string;
	readonly in: readonly string[];
	readonly variantProp: string;
	readonly default: string;
	readonly fixed?: { readonly height: number } | undefined;
};

export type AreaScreen = {
	readonly frame: string;
	// Clave de screens@1
	readonly screen?: string | undefined;
	// Valor de `shell.variantProp` para esta pantalla
	readonly shell?: string | undefined;
};

export type FillSpec = {
	readonly frame: string;
	readonly find: {
		readonly text: string;
		readonly minSize: readonly [number, number];
	};
	// Ruta relativa al fichero de áreas
	readonly asset: string;
	readonly name?: string | undefined;
};

export type Area = {
	readonly name: string;
	readonly page: string;
	readonly frame: AreaFrameShape;
	readonly place: PlaceSpec;
	readonly shell?: ShellSpec | undefined;
	readonly main?: readonly string[] | undefined;
	readonly screens: readonly AreaScreen[];
	readonly clickable?: Clickable | undefined;
	readonly links?: readonly Link[] | undefined;
	readonly flowStart?:
		| { readonly frame: string; readonly name: string }
		| undefined;
	readonly fills?: readonly FillSpec[] | undefined;
};

export type Shared = {
	readonly name: string;
	readonly set: string;
	readonly page: { readonly name: string; readonly after?: string | undefined };
	readonly part: readonly string[];
	readonly variantProp: string;
	readonly from: readonly {
		readonly area: string;
		readonly frame: string;
		readonly value: string;
	}[];
	readonly sheet?:
		| { readonly gap: number; readonly padding: number }
		| undefined;
};

export type AreasFile = {
	readonly contract: typeof AREAS_CONTRACT;
	readonly linkRules: LinkRules;
	readonly areas: readonly Area[];
	readonly shared?: readonly Shared[] | undefined;
};

// Un fallo del fichero: dónde (puntero JSON, RFC 6901; «» es la raíz) y qué
export type AreasIssue = {
	readonly pointer: string;
	readonly message: string;
};
