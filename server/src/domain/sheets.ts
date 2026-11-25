// sheets@1: los datos de cada hoja de componente. Tipos puros, sin imports: el esquema zod que los valida en el borde vive en adapters/contracts/sheets.ts y se
// comprueba contra estos tipos al compilar.

export const SHEETS_CONTRACT = "sheets@1";

// El nombre de una variable de Figma (colección ya decidida por map@1), p. ej. «brand/50»
export type SheetVariable = string;

export type SheetStyle = {
	readonly header: {
		readonly fill: SheetVariable;
		readonly text: SheetVariable;
	};
	readonly card: { readonly fill: SheetVariable };
	readonly texts: {
		readonly description: SheetVariable;
		readonly bug: SheetVariable;
		readonly tag: SheetVariable;
		readonly rowLabel: SheetVariable;
		readonly colLabel: SheetVariable;
	};
	// Los textos del aviso de fallo conocido: de la web del proyecto, no de la herramienta
	readonly bug?:
		| { readonly prefix: string; readonly setPrefix: string }
		| undefined;
	readonly matrix: { readonly stroke: SheetVariable };
};

export type SheetMatrix = {
	readonly rows?: readonly string[] | undefined;
	readonly align?: "top" | "center" | undefined;
};

export type SheetText = { readonly name: string; readonly match: string };

export type SheetBoolean = {
	readonly name: string;
	readonly layer: string;
	readonly on?: boolean | undefined;
};

export type SheetIcon = {
	readonly icon: string;
	readonly boolean?: string | undefined;
	readonly swap?: string | undefined;
	readonly on?: boolean | undefined;
	readonly noBooleanWhen?: Readonly<Record<string, string>> | undefined;
};

export type SheetSlot = {
	readonly name: string;
	readonly layer: string;
	readonly boolean?: string | undefined;
};

export type SheetLayerName = {
	readonly classes: string;
	readonly name: string;
};

export type SheetPage = {
	readonly name: string;
	readonly after?: string | undefined;
	readonly section?: string | undefined;
};

// Una capa hecha a mano de las variantes que el repintado borraría: nombre, tipo, las propiedades que usa (sin `#id`) y
// las variantes donde está
export type HandMadeLayer = {
	readonly name: string;
	readonly type: string;
	readonly properties: readonly string[];
	readonly variants: readonly string[];
};

// Cómo estaba el set de una hoja en Figma al decidir un desfase: las props de variante con sus valores, los
// nombres de las variantes, los de las propiedades que no son de variante y sus capas hechas a mano; todo ordenado y sin `#id`
export type SetFingerprint = {
	readonly variantProps: Readonly<Record<string, readonly string[]>>;
	readonly variants: readonly string[];
	readonly properties: readonly string[];
	readonly layers: readonly HandMadeLayer[];
};

// La decisión de la persona cuando Figma va por delante de la web: manda Figma (se salta), manda la web (se rehace) o se
// empareja añadiendo a las variantes de la web esos valores para las props que solo tiene Figma
export type SheetDrift =
	| {
			readonly decision: "figma" | "web";
			readonly fingerprint: SetFingerprint;
	  }
	| {
			readonly decision: "map";
			readonly values: Readonly<Record<string, string>>;
			readonly fingerprint: SetFingerprint;
	  };

export type Sheet = {
	readonly key: string;
	readonly screen: string;
	readonly title: string;
	readonly page: SheetPage;
	readonly description: string;
	readonly bug?: string | undefined;
	readonly tag?: string | undefined;
	// Ruta de la plantilla del componente en el código del proyecto: de ahí sale el mapeo a código de design-context@1
	readonly source?: string | undefined;
	readonly matrix?: SheetMatrix | undefined;
	readonly texts?: readonly SheetText[] | undefined;
	readonly booleans?: readonly SheetBoolean[] | undefined;
	readonly icons?: readonly SheetIcon[] | undefined;
	readonly slots?: readonly SheetSlot[] | undefined;
	readonly names?: readonly SheetLayerName[] | undefined;
	readonly exposed?: readonly string[] | undefined;
	readonly flowIcons?: boolean | undefined;
	readonly rules?: readonly string[] | undefined;
	readonly keep?: readonly string[] | undefined;
	readonly drift?: SheetDrift | undefined;
};

export type SheetsFile = {
	readonly contract: typeof SHEETS_CONTRACT;
	readonly style: SheetStyle;
	readonly sections?:
		| Readonly<Record<string, { readonly default?: boolean | undefined }>>
		| undefined;
	readonly sheets: readonly Sheet[];
};

export type SheetsIssue = {
	readonly pointer: string;
	readonly message: string;
};
