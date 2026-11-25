// screen@1: el plan de una pantalla. Lo arma el servidor desde la última captura válida y
// map@1, sin tocar Figma, y el kit lo pinta. Tipos puros; solo importan tipos del dominio vecino.
import type { CaptureNode } from "./capture.ts";
import type { Fingerprints, MapFile } from "./map.ts";

export const SCREEN_CONTRACT = "screen@1";

// Claves con las que el kit etiqueta lo que crea. El kit repite estos prefijos (no puede
// importar el servidor) y un test los cruza
export const SCREEN_KEY_PREFIX = "fcc:screen:";
export const SCREEN_PAGE_KEY_PREFIX = "fcc:screen-page:";
// Página donde se pinta una pantalla cuando el paso no trae área
export const SCREEN_PAGE_NAME_PREFIX = "fcc · pantalla · ";

export const screenKey = (screen: string): string =>
	`${SCREEN_KEY_PREFIX}${screen}`;
export const screenPageKey = (screen: string): string =>
	`${SCREEN_PAGE_KEY_PREFIX}${screen}`;

// Carpeta (dentro de la de salida del proyecto) donde el servidor deja el plan de cada paso
export const SCREEN_PLANS_DIR = "screen-plans";

// Figma no admite una imagen de más de este lado en píxeles (createImage lanza); medido en F3
export const MAX_FIGMA_IMAGE_SIDE = 4096;

export const PLAN_WARNING = Object.freeze({
	imageTooLarge: "IMAGE_TOO_LARGE",
	layerNameUnknown: "LAYER_NAME_UNKNOWN",
	iconKeyUnknown: "ICON_KEY_UNKNOWN",
} as const);
export type PlanWarningCode = (typeof PLAN_WARNING)[keyof typeof PLAN_WARNING];

export type PlanWarning = {
	readonly code: PlanWarningCode;
	readonly nodeId?: string | undefined;
	readonly message: string;
};

export type PlanImage = {
	// Nombre del asset con los bytes (el sha256 de la imagen)
	readonly asset: string;
	readonly width: number;
	readonly height: number;
	readonly type: "png" | "jpeg";
	readonly tooLarge?: boolean | undefined;
};

// La parte de map@1 que usa el kit: sin la ruta del catálogo (sale resuelto en `icons`)
export type PlanMap = {
	readonly tokens: MapFile["tokens"];
	readonly fonts: MapFile["fonts"];
	readonly effects?: MapFile["effects"];
	readonly icons: Omit<MapFile["icons"], "catalog">;
	readonly layers: MapFile["layers"];
	readonly screen?: MapFile["screen"];
	// F4b: solo las clases genéricas; las huellas van aparte, en el plan
	readonly components?:
		| { readonly genericClasses: readonly string[] }
		| undefined;
};

export type PlanSource = {
	readonly path: string;
	readonly sha256: string;
};

export type ScreenPlan = {
	readonly contract: typeof SCREEN_CONTRACT;
	readonly screen: string;
	readonly title: string;
	readonly variant: number;
	readonly props: Readonly<Record<string, string>>;
	readonly sources: {
		readonly capture: PlanSource;
		readonly map: PlanSource;
		// F4b: el hash del módulo recognize@1 que lleva el código del paso
		readonly recognize?: { readonly sha256: string } | undefined;
	};
	readonly target: {
		readonly page: {
			readonly name: string;
			readonly key: string;
			readonly after?: string | undefined;
		};
		readonly frame: { readonly name: string; readonly key: string };
	};
	readonly root: readonly CaptureNode[];
	readonly images: Readonly<Record<string, PlanImage>>;
	// clave de trazados → nombre del icono del catálogo
	readonly icons: Readonly<Record<string, string>>;
	readonly map: PlanMap;
	// F4b: las huellas de los componentes hoja y las reglas que se prueban en esta pantalla
	readonly fingerprints?: Fingerprints | undefined;
	readonly rules?: readonly string[] | undefined;
	readonly warnings: readonly PlanWarning[];
};
