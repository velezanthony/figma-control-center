// design-context@1: lo que Claude necesita de un nodo de Figma para escribir o ajustar su
// plantilla, como datos y no como código. Tipos puros, sin imports: el esquema zod que los valida en el borde vive en
// adapters/contracts/design-context.ts y se comprueba contra estos tipos al compilar.

export const DESIGN_CONTEXT_CONTRACT = "design-context@1";

// Dónde guarda el kit la clave de un nodo (`setSharedPluginData`): kits/figma/types.ts repite estos dos valores (NS y KEY)
// porque no puede importar el servidor, y un test los cruza
export const NODE_KEY_NAMESPACE = "fcc";
export const NODE_KEY_FIELD = "key";

// De qué viene un nodo según la clave `fcc:` que lleva él o su frame de primer nivel (R-2: las áreas también)
export const ORIGIN_KIND = Object.freeze({
	area: "area",
	screen: "screen",
	sheet: "sheet",
	compose: "compose",
} as const);
export type OriginKind = (typeof ORIGIN_KIND)[keyof typeof ORIGIN_KIND];

// Por qué vía se encontró la hoja de un componente (R-1): su clave `fcc:sheet:` o el nombre de su set
export const CODE_BY = Object.freeze({ key: "key", name: "name" } as const);
export type CodeBy = (typeof CODE_BY)[keyof typeof CODE_BY];

export const DESIGN_WARNING = Object.freeze({
	noCodeMapping: "NO_CODE_MAPPING",
	// La captura del nodo falló: el contexto se guarda igual, solo falta la imagen
	screenshotFailed: "SCREENSHOT_FAILED",
} as const);
export type DesignWarningCode =
	(typeof DESIGN_WARNING)[keyof typeof DESIGN_WARNING];

export const TRUNCATED_REASON = "max-nodes";

// A qué escala se saca la captura que acompaña al contexto (la que `figma_screenshot` usa por defecto)
export const DESIGN_CONTEXT_SCREENSHOT_SCALE = 1;

export const COMPONENT_KIND = Object.freeze({
	set: "COMPONENT_SET",
	component: "COMPONENT",
} as const);
export type ComponentKind =
	(typeof COMPONENT_KIND)[keyof typeof COMPONENT_KIND];

export const LAYOUT_MODE = Object.freeze({
	horizontal: "HORIZONTAL",
	vertical: "VERTICAL",
	grid: "GRID",
} as const);
export type LayoutMode = (typeof LAYOUT_MODE)[keyof typeof LAYOUT_MODE];

export const SIZING = Object.freeze({
	fixed: "FIXED",
	hug: "HUG",
	fill: "FILL",
} as const);
export type Sizing = (typeof SIZING)[keyof typeof SIZING];

export const STYLE_KINDS = ["paint", "text", "effect", "grid"] as const;
export type DesignStyleKind = (typeof STYLE_KINDS)[number];

// Un valor crudo: un número, un texto, un booleano o un objeto de Figma (una pintura, un efecto…)
export type DesignRaw =
	| number
	| string
	| boolean
	| readonly unknown[]
	| { readonly [key: string]: unknown };

// Cada valor de un nodo es una de tres cosas: algo suelto (`raw`, lo que hay que mirar dos veces), una variable (por su
// id en `variables`) o un estilo (por su id en `styles`)
export type DesignValue =
	| { readonly raw: DesignRaw }
	| { readonly variable: string }
	| { readonly style: string };

export type DesignOrigin = {
	readonly kind: OriginKind;
	readonly key: string;
};

export type DesignBox = {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
};

// La maquetación de un contenedor con auto-layout
export type DesignLayout = {
	readonly mode: LayoutMode;
	readonly wrap: boolean;
	readonly gap: DesignValue;
	readonly counterGap?: DesignValue | undefined;
	// Arriba, derecha, abajo, izquierda
	readonly padding: readonly [
		DesignValue,
		DesignValue,
		DesignValue,
		DesignValue,
	];
	readonly primaryAlign: string;
	readonly counterAlign: string;
};

// Cómo se coloca un nodo en su padre con auto-layout (también un texto o una instancia, que no son contenedores)
export type DesignPlacement = {
	readonly sizing: { readonly h: Sizing; readonly v: Sizing };
	readonly positioning?: "ABSOLUTE" | undefined;
	readonly min?:
		| { readonly w?: number | undefined; readonly h?: number | undefined }
		| undefined;
	readonly max?:
		| { readonly w?: number | undefined; readonly h?: number | undefined }
		| undefined;
};

export type DesignCorners = {
	readonly tl: DesignValue;
	readonly tr: DesignValue;
	readonly br: DesignValue;
	readonly bl: DesignValue;
};

// Una medida de Figma: `{ unit: "PIXELS" | "PERCENT", value }` o `{ unit: "AUTO" }`
export type DesignMeasure = {
	readonly unit: string;
	readonly value?: number | undefined;
};

export type DesignFont = {
	readonly family: string;
	readonly style: string;
	readonly size: number;
	readonly lineHeight: DesignMeasure;
	readonly letterSpacing: DesignMeasure;
};

export type DesignText = {
	readonly characters: string;
	readonly font: DesignFont;
	// Estilo de texto de Figma (id en `styles`)
	readonly style?: string | undefined;
	// Solo si el texto tiene más de un tramo con formato distinto
	readonly segments?:
		| readonly {
				readonly start: number;
				readonly end: number;
				readonly font: DesignFont;
		  }[]
		| undefined;
};

export type DesignInstance = {
	// Clave del set o del componente, que es la de `components`
	readonly component: string;
	readonly variant: Readonly<Record<string, string>>;
	// Propiedades que no son de variante, sin el `#id` de Figma
	readonly props: Readonly<Record<string, string | boolean>>;
	// Lo que esta instancia cambió respecto a su componente: `<campo>` o `<capa>.<campo>`
	readonly overridden: readonly string[];
};

// Lo que el mapeo a código sugiere para un nodo que no es una instancia (D-3)
export type DesignHints = {
	// Clases que darían el mismo valor según map@1 leído al revés
	readonly classes: readonly string[];
	// Campos con un valor suelto que map@1 no sabe escribir como clase: o falta un token o el diseño se salió del sistema
	readonly unmapped: readonly string[];
};

export type DesignNode = {
	readonly id: string;
	// null en la raíz
	readonly parent: string | null;
	readonly name: string;
	readonly type: string;
	readonly visible: boolean;
	readonly box: DesignBox;
	readonly layout?: DesignLayout | undefined;
	readonly placement?: DesignPlacement | undefined;
	readonly fills?: readonly DesignValue[] | undefined;
	readonly strokes?: readonly DesignValue[] | undefined;
	readonly strokeWeight?: DesignValue | undefined;
	readonly effects?: readonly DesignValue[] | undefined;
	readonly radius?: DesignCorners | undefined;
	readonly opacity?: number | undefined;
	readonly text?: DesignText | undefined;
	readonly instance?: DesignInstance | undefined;
	// De `report.matches` del último `kit/build-screen@1`: por qué esta instancia es la que es
	readonly matched?: { readonly by: string } | undefined;
	readonly hints?: DesignHints | undefined;
};

export type DesignVariable = {
	readonly name: string;
	readonly collection: string;
	readonly type: string;
	// En el modo por defecto, con los alias ya seguidos hasta el valor
	readonly value: DesignRaw;
	// Los nombres de las variables por las que pasa un alias, hasta llegar al valor
	readonly aliasOf?: readonly string[] | undefined;
	// La clase (sin prefijo de uso) que map@1 sabe escribir para esta variable
	readonly codeClass?: string | undefined;
};

export type DesignStyle = {
	readonly name: string;
	readonly kind: DesignStyleKind;
	readonly key: string;
	readonly value: DesignRaw;
};

export type DesignComponentProperty = {
	readonly name: string;
	readonly type: string;
	readonly default: string | boolean | null;
};

export type DesignCode = {
	// Ruta de la plantilla (el `source` de la hoja de sheets@1)
	readonly source: string;
	readonly tag?: string | undefined;
	readonly by: CodeBy;
};

export type DesignComponent = {
	readonly name: string;
	readonly kind: ComponentKind;
	readonly key: string;
	readonly remote: boolean;
	readonly library?: string | undefined;
	readonly variants: Readonly<Record<string, readonly string[]>>;
	readonly properties: readonly DesignComponentProperty[];
	// Clave de la hoja de sheets@1 (por `fcc:sheet:` o por el nombre del set)
	readonly sheet?: string | undefined;
	readonly code?: DesignCode | undefined;
	// Sin `code`: las hojas (o los componentes de las huellas) que podrían ser, para que decida la persona
	readonly candidates?: readonly string[] | undefined;
};

export type DesignWarning = {
	readonly code: DesignWarningCode;
	readonly message: string;
	// La clave del componente al que se refiere
	readonly component?: string | undefined;
};

export type DesignTruncated = {
	readonly reason: typeof TRUNCATED_REASON;
	// Los ids que quedaron sin leer, para pedirlos aparte
	readonly children: readonly string[];
};

// Lo que lee la pestaña: el contexto sin el mapeo a código ni la clave del archivo, que pone el servidor
export type DesignRead = {
	readonly fileName: string;
	readonly root: string;
	readonly origin?: DesignOrigin | undefined;
	readonly nodes: readonly DesignNode[];
	readonly variables: Readonly<Record<string, DesignVariable>>;
	readonly styles: Readonly<Record<string, DesignStyle>>;
	readonly components: Readonly<Record<string, DesignComponent>>;
	readonly truncated?: DesignTruncated | undefined;
};

export type DesignContext = {
	readonly contract: typeof DESIGN_CONTEXT_CONTRACT;
	readonly file: { readonly key: string; readonly name: string };
	// ISO 8601
	readonly readAt: string;
	readonly root: string;
	readonly origin?: DesignOrigin | undefined;
	readonly nodes: readonly DesignNode[];
	readonly variables: Readonly<Record<string, DesignVariable>>;
	readonly styles: Readonly<Record<string, DesignStyle>>;
	readonly components: Readonly<Record<string, DesignComponent>>;
	readonly truncated?: DesignTruncated | undefined;
	readonly warnings?: readonly DesignWarning[] | undefined;
};

// Los pedidos de la lectura (lo que viaja como `params` al script de la pestaña)
export type DesignContextQuery = {
	readonly nodeId: string;
	readonly maxNodes: number;
	// Con un set como raíz: la variante que se recorre (R-3); sin ella, la que el set tiene por defecto
	readonly variant: Readonly<Record<string, string>> | null;
};
