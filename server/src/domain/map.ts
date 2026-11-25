// map@1: los datos de correspondencia código → Figma que necesita pintar una pantalla.
// Tipos puros, sin imports: el esquema zod que los valida en el borde vive en adapters/contracts/map.ts y se comprueba
// contra estos tipos al compilar.

export const MAP_CONTRACT = "map@1";

// Una expresión regular escrita como texto (sin barras ni banderas); la compila quien la usa
export const MAX_REGEX_LENGTH = 200;

export type MapClassToVariable = {
	readonly from: string;
	readonly to: string;
};

export type MapTokens = {
	readonly collections: readonly string[];
	readonly classPrefixes: {
		readonly fill: readonly string[];
		readonly text: readonly string[];
		readonly stroke: readonly string[];
		// Para el color de un svg; sin él, valen text + stroke + fill (en ese orden)
		readonly svg?: readonly string[] | undefined;
	};
	readonly classToVariable: readonly MapClassToVariable[];
	readonly fallback?: { readonly collection: string } | undefined;
	readonly numbers?:
		| {
				readonly radius?:
					| { readonly prefix: string; readonly full?: string | undefined }
					| undefined;
				readonly spacing?: { readonly prefix: string } | undefined;
		  }
		| undefined;
};

export type MapFonts = {
	readonly families: readonly {
		readonly match: string;
		readonly family: string;
	}[];
	readonly default: string;
	readonly styles: Readonly<Record<string, string>>;
	readonly italic: { readonly suffix: string };
	readonly strict?: readonly string[] | undefined;
	// Familia que se usa si la que pide la pantalla no está en Figma (el paso avisa FONT_FALLBACK)
	readonly fallback?: string | undefined;
};

export type MapIcons = {
	readonly pages: string;
	readonly prefix: string;
	// Ruta a un JSON [{ name, svg }], relativa a este fichero
	readonly catalog: string;
	readonly glyphs?:
		| { readonly classPattern: string; readonly prefix: string }
		| undefined;
};

export type MapLayers = {
	readonly roles: Readonly<Record<string, string>>;
	readonly textPrefix: boolean;
};

// F4b: las huellas de componentes, sus hojas y las reglas que se prueban en cada pantalla
export type MapComponents = {
	// Ruta a un JSON { <componente>: huella }, relativa a este fichero
	readonly fingerprints: string;
	// Los componentes de `fingerprints` que se reconocen (los demás no entran en el plan)
	readonly leaf: readonly string[];
	// Clases de maquetación que no distinguen un componente: expresiones sobre la clase entera
	readonly genericClasses: readonly string[];
};

export type MapScreen = {
	// Las reglas de recognize@1 que se prueban en esa pantalla; sin ellas, todas
	readonly rules?: readonly string[] | undefined;
};

export type FingerprintSig = {
	readonly tag: string;
	readonly cls: readonly string[];
};

// Una huella (fingerprints.json del proyecto): etiqueta y clases fijas de la raíz, firma y clases condicionales
export type Fingerprint = {
	readonly title: string;
	readonly tag: string;
	readonly cls: readonly string[];
	readonly opt?: readonly string[] | undefined;
	readonly cond?:
		| Readonly<Record<string, readonly [string, string]>>
		| undefined;
	readonly defaults?: Readonly<Record<string, string>> | undefined;
	readonly alias?: Readonly<Record<string, string>> | undefined;
	readonly sig?: FingerprintSig | null | undefined;
	readonly sig_cond?: FingerprintSig | null | undefined;
};

export type Fingerprints = Readonly<Record<string, Fingerprint>>;

export type MapFile = {
	readonly contract: typeof MAP_CONTRACT;
	readonly tokens: MapTokens;
	readonly fonts: MapFonts;
	readonly effects?: { readonly classPattern: string } | undefined;
	readonly icons: MapIcons;
	readonly layers: MapLayers;
	readonly screen?: { readonly background?: string | undefined } | undefined;
	readonly components?: MapComponents | undefined;
	readonly screens?: Readonly<Record<string, MapScreen>> | undefined;
};

export type MapIssue = { readonly pointer: string; readonly message: string };

export type IconEntry = { readonly name: string; readonly svg: string };
