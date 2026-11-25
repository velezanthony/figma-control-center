// Tipos y constantes del kit de Figma (figma-kit@1). Los tipos del API salen del paquete de tipos como `import type`
// (se borran al empaquetar): así el kit no declara el global `figma` ni mezcla sus tipos con los de Node.
import type {
	ComponentNode,
	ComponentSetNode,
	Effect,
	EffectStyle,
	FrameNode,
	GradientPaint,
	InstanceNode,
	PageNode,
	Paint,
	Reaction,
	RectangleNode,
	SceneNode,
	TextNode,
	TextStyle,
	Variable,
} from "@figma/plugin-typings/plugin-api-standalone.d.ts";

export type {
	ComponentNode,
	ComponentSetNode,
	Effect,
	EffectStyle,
	FrameNode,
	GradientPaint,
	InstanceNode,
	PageNode,
	Paint,
	Reaction,
	RectangleNode,
	SceneNode,
	TextNode,
	TextStyle,
	Variable,
};

// Claves con las que el kit etiqueta lo que crea en las áreas (el servidor las repite en domain/areas.ts; un test las cruza)
export const AREA_KEY_PREFIX = "fcc:area:";
export const SHARED_KEY_PREFIX = "fcc:shared:";
// La de un compose@1 (el servidor la repite en domain/compose.ts; un test las cruza)
export const COMPOSE_KEY_PREFIX = "fcc:compose:";
export const COMPOSE_PAGE_KEY_PREFIX = "fcc:compose-page:";
export const composePageKey = (compose: string): string =>
	`${COMPOSE_PAGE_KEY_PREFIX}${compose}`;
export const composeKey = (compose: string): string =>
	`${COMPOSE_KEY_PREFIX}${compose}`;
// Las de las hojas de componentes (el servidor las repite en domain/component-plan.ts; un test las cruza)
export const SHEET_KEY_PREFIX = "fcc:sheet:";
export const SHEET_VARIANT_KEY_PREFIX = "fcc:sheet-variant:";
export const SHEET_SCRATCH_KEY_PREFIX = "fcc:sheet-scratch:";

export const KIT_VERSION = "figma-kit@1";
// Donde el servidor instala el kit en la pestaña, y donde deja el hash del empaquetado que instaló
export const KIT_GLOBAL = "__fccFigmaKit";
export const KIT_SHA_GLOBAL = "__fccFigmaKitSha";
// Espacio de `setSharedPluginData` y clave donde se guarda la clave de un nodo (setPluginData no vale fuera de un plugin)
export const NS = "fcc";
export const KEY = "key";
// Lo que lleva delante el mensaje de `kit.fail`; el servidor lo lee y lo convierte en un error con su siguiente paso
export const FAIL_MARKER = "__fcc_kit_fail__:";

export type Ref = { readonly id: string } | string;

export type StepWarning = {
	code: string;
	message: string;
	nodeId?: string;
};

// Lo que devuelve `track().done()`: la forma de step@1 (el kit no puede importar el servidor; un test lo comprueba)
export type StepResult = {
	createdNodeIds: string[];
	mutatedNodeIds: string[];
	removedNodeIds?: string[];
	warnings?: StepWarning[];
	report?: Record<string, unknown>;
};

export type Tracker = {
	created<T extends Ref | readonly Ref[]>(what: T): T;
	mutated<T extends Ref | readonly Ref[]>(what: T): T;
	removed<T extends Ref | readonly Ref[]>(what: T): T;
	warn(code: string, message: string, nodeId?: string): void;
	done(report?: Record<string, unknown>): StepResult;
};
