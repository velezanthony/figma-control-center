// component@1: el plan de una hoja de componente. Lo arma el servidor desde la última
// captura válida, sheets@1 y map@1, sin tocar Figma, y el kit lo pinta. Tipos puros; solo importan tipos vecinos.
import type { CaptureNode } from "./capture.ts";
import type { Fingerprints } from "./map.ts";
import type { PlanImage, PlanMap, PlanSource } from "./screen-plan.ts";
import type { Sheet, SheetStyle } from "./sheets.ts";

export const COMPONENT_CONTRACT = "component@1";

// Claves con las que el kit etiqueta lo que crea. El kit repite estos prefijos (no puede importar el servidor) y un test
// los cruza
export const SHEET_KEY_PREFIX = "fcc:sheet:";
export const SHEET_PAGE_KEY_PREFIX = "fcc:sheet-page:";
export const SHEET_VARIANT_KEY_PREFIX = "fcc:sheet-variant:";
export const SHEET_SCRATCH_KEY_PREFIX = "fcc:sheet-scratch:";
// Nombre de la página aparte (modo scratch)
export const SHEET_SCRATCH_PAGE_PREFIX = "fcc · hoja · ";

export const sheetKey = (sheet: string): string =>
	`${SHEET_KEY_PREFIX}${sheet}`;
export const sheetPageKey = (sheet: string): string =>
	`${SHEET_PAGE_KEY_PREFIX}${sheet}`;
export const sheetScratchKey = (sheet: string): string =>
	`${SHEET_SCRATCH_KEY_PREFIX}${sheet}`;

// Carpeta (dentro de la de salida del proyecto) donde el servidor deja el plan de cada paso
export const SHEET_PLANS_DIR = "sheet-plans";

export const SHEET_WARNING = Object.freeze({
	imageTooLarge: "IMAGE_TOO_LARGE",
	iconKeyUnknown: "ICON_KEY_UNKNOWN",
	fingerprintWithoutSheet: "FINGERPRINT_WITHOUT_SHEET",
	ruleUnnamed: "RULE_UNNAMED",
} as const);
export type SheetWarningCode =
	(typeof SHEET_WARNING)[keyof typeof SHEET_WARNING];

export type SheetPlanWarning = {
	readonly code: SheetWarningCode;
	readonly nodeId?: string | undefined;
	readonly message: string;
};

export type ComponentVariant = {
	readonly props: Readonly<Record<string, string>>;
	readonly root: readonly CaptureNode[];
};

// Las etiquetas de la matriz y qué variantes van en cada fila
export type ComponentMatrix = {
	// Una etiqueta por fila, `prop=valor · prop=valor`
	readonly rows: readonly string[];
	// Una etiqueta por columna; vacío si ninguna columna se distingue por sus propiedades
	readonly columns: readonly string[];
	// Por fila, los índices (en `variants`) de sus variantes, en orden de captura
	readonly cells: readonly (readonly number[])[];
};

export type ComponentPlan = {
	readonly contract: typeof COMPONENT_CONTRACT;
	readonly sheet: Sheet;
	// El estilo de la cabecera, la tarjeta y la matriz (de sheets@1): el kit lo necesita para pintarlos
	readonly style: SheetStyle;
	readonly sources: {
		readonly capture: PlanSource;
		readonly sheets: PlanSource;
		readonly map: PlanSource;
		readonly recognize?: { readonly sha256: string } | undefined;
	};
	readonly target: {
		readonly page: {
			readonly name: string;
			readonly key: string;
			readonly after?: string | undefined;
			readonly section?: string | undefined;
		};
		readonly set: { readonly name: string; readonly key: string };
	};
	readonly variants: readonly ComponentVariant[];
	readonly images: Readonly<Record<string, PlanImage>>;
	readonly icons: Readonly<Record<string, string>>;
	readonly map: PlanMap;
	// Las huellas de los componentes hoja menos la del propio set
	readonly fingerprints?: Fingerprints | undefined;
	readonly rules?: readonly string[] | undefined;
	readonly matrix: ComponentMatrix;
	readonly warnings: readonly SheetPlanWarning[];
};
