// Los tres contratos de la captura de la web: project@1 (la configuración del proyecto),
// screens@1 (qué se captura) y capture@1 (lo que sale). Tipos puros, sin imports: los esquemas zod que los validan en el
// borde viven en adapters/contracts/{project,screens,capture}.ts y se comprueban contra estos tipos al compilar.

export const CONTRACT = Object.freeze({
	project: "project@1",
	screens: "screens@1",
	capture: "capture@1",
} as const);

// El kit de captura que corre en el navegador (kits/capture → kits/dist/capture-kit.js)
export const CAPTURE_KIT = "capture-kit@1";

// Nombre fijo del fichero de configuración en la carpeta del proyecto (D-4)
export const PROJECT_CONFIG_FILE = "figma-control-center.json";

export type Viewport = { readonly w: number; readonly h: number };

export type WebUser = { readonly username: string; readonly secretRef: string };

export type WebLogin = {
	readonly path: string;
	readonly fields: { readonly user: string; readonly password: string };
	readonly submit?: string | undefined;
};

export type WebConfig = {
	readonly baseUrl: string;
	readonly viewport: Viewport;
	readonly screenScale?: number | undefined;
	readonly devicePixelRatio?: number | undefined;
	readonly login?: WebLogin | undefined;
	readonly users?: Readonly<Record<string, WebUser>> | undefined;
	readonly strip?: readonly string[] | undefined;
	readonly hideScrollbar?: boolean | undefined;
};

export type ProjectConfig = {
	readonly contract: typeof CONTRACT.project;
	readonly web: WebConfig;
	readonly screens: string;
	readonly hooks?: string | undefined;
	// Ruta al areas@1 (F3), relativa a este fichero
	readonly areas?: string | undefined;
	// Ruta al map@1 (F4), relativa a este fichero
	readonly map?: string | undefined;
	// Ruta al módulo recognize@1 (F4b), relativa a este fichero: se lee como texto y viaja dentro del código del paso
	readonly recognize?: string | undefined;
	// Ruta al sheets@1 (hojas de componentes), relativa a este fichero
	readonly sheets?: string | undefined;
	// Carpeta de los compose@1 (diseñar en Figma sin web previa), relativa a este fichero
	readonly compose?: string | undefined;
};

// Una acción de una variante: un clic en el mundo aislado, o una expresión en el mundo de la página (pide aprobación)
export type CaptureAction =
	| { readonly click: string }
	| { readonly evaluateInPage: string };

// Una pseudoclase que se fuerza sobre un elemento antes de medir (`CSS.forcePseudoState`)
export const FORCED_STATES = [
	"hover",
	"focus",
	"focus-visible",
	"active",
] as const;
export type ForcedState = (typeof FORCED_STATES)[number];
export type ForcedPseudo = {
	readonly selector: string;
	readonly state: ForcedState;
};

export type ScreenVariant = {
	readonly props: Readonly<Record<string, string>>;
	// Pares que se añaden a la url de la pantalla, en el orden escrito (un componente de la galería: una query por variante)
	readonly query?: Readonly<Record<string, string>> | undefined;
	readonly run?: readonly CaptureAction[] | undefined;
	readonly until?: string | undefined;
	// Tamaño de la pestaña solo para esta variante (la vista móvil de un componente); sin él, el de la pantalla o el de project@1
	readonly viewport?: Viewport | undefined;
	// Pseudoclases forzadas tras las acciones y el `until`, antes de medir; se quitan al acabar la variante
	readonly force?: readonly ForcedPseudo[] | undefined;
};

export type Screen = {
	readonly key: string;
	readonly title: string;
	readonly url: string;
	readonly session?: string | undefined;
	readonly pick?: string | undefined;
	readonly until?: string | undefined;
	// Tamaño de la pestaña solo para esta pantalla; sin él, el de project@1
	readonly viewport?: Viewport | undefined;
	readonly variants?: readonly ScreenVariant[] | undefined;
};

export type ScreensFile = {
	readonly contract: typeof CONTRACT.screens;
	readonly screens: readonly Screen[];
};

// --- capture@1 ---
// Un nodo lleva campos y nombres cortos, más `id` y `path`; las imágenes van por `ref` (sha256 de sus bytes) en vez de `data:`.

export type Rgba = readonly [number, number, number, number];
export type Box4 = readonly [number, number, number, number];

export type Font = {
	readonly fam: string;
	readonly size: number;
	readonly weight: string;
	readonly lh: string;
	readonly ls: string;
	readonly tt: string;
	readonly td: string;
	readonly fs: string;
	readonly ta: string;
	readonly ws: string;
	readonly color: Rgba | null;
};

export type Shadow = {
	readonly c: Rgba;
	readonly x: number;
	readonly y: number;
	readonly b: number;
	readonly s: number;
	readonly inset: boolean;
};

export type GradientStop = { readonly c: Rgba; readonly p: number };

export type Gradient =
	| { readonly angle: number; readonly stops: readonly GradientStop[] }
	| { readonly radial: true; readonly stops: readonly GradientStop[] };

export const NODE_TYPE = Object.freeze({
	frame: "frame",
	text: "text",
	svg: "svg",
	img: "img",
	icon: "icon",
} as const);

type NodeBase = {
	readonly id: string;
	readonly path: string;
	readonly tag?: string | undefined;
	readonly cls?: string | undefined;
	readonly x?: number | undefined;
	readonly y?: number | undefined;
	readonly w: number;
	readonly h: number;
	readonly pos?: string | undefined;
	readonly op?: number | undefined;
	readonly top?: boolean | undefined;
};

export type FrameNode = NodeBase & {
	readonly t: typeof NODE_TYPE.frame;
	readonly disp?: string | undefined;
	readonly dir?: string | undefined;
	readonly wrap?: string | undefined;
	readonly jc?: string | undefined;
	readonly ai?: string | undefined;
	readonly gap?: number | undefined;
	readonly rgap?: number | undefined;
	readonly pad?: Box4 | undefined;
	readonly bg?: Rgba | null | undefined;
	readonly bw?: Box4 | undefined;
	readonly bc?: Rgba | null | undefined;
	readonly bcb?: Rgba | null | undefined;
	readonly rad?: Box4 | undefined;
	readonly sh?: string | undefined;
	readonly shs?: readonly Shadow[] | undefined;
	readonly fl?: string | undefined;
	readonly ov?: string | undefined;
	readonly ml?: number | undefined;
	readonly font?: Font | undefined;
	readonly va?: string | undefined;
	readonly grad?: Gradient | null | undefined;
	readonly fg?: number | undefined;
	readonly kids: readonly CaptureNode[];
};

export type TextNode = NodeBase & {
	readonly t: typeof NODE_TYPE.text;
	readonly txt: string;
	readonly lines?: number | undefined;
	readonly font?: Font | undefined;
	readonly ml?: number | undefined;
	readonly mr?: number | undefined;
};

export type SvgNode = NodeBase & {
	readonly t: typeof NODE_TYPE.svg;
	readonly svg: string;
	readonly key?: string | undefined;
	readonly color?: Rgba | null | undefined;
	readonly spin?: boolean | undefined;
};

export type ImgNode = NodeBase & {
	readonly t: typeof NODE_TYPE.img;
	readonly ref: string;
	readonly src?: string | undefined;
	readonly fit?: string | undefined;
	readonly rad?: Box4 | undefined;
	readonly glyph?: string | undefined;
};

export type IconNode = NodeBase & {
	readonly t: typeof NODE_TYPE.icon;
	readonly name: string;
	readonly color?: Rgba | null | undefined;
};

export type CaptureNode = FrameNode | TextNode | SvgNode | ImgNode | IconNode;

export const IMAGE_TYPES = ["png", "jpeg"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export type CaptureImage = {
	readonly path: string;
	readonly width: number;
	readonly height: number;
	readonly type: ImageType;
};

export type CaptureVariant = {
	readonly props: Readonly<Record<string, string>>;
	readonly nodes: readonly CaptureNode[];
	// La capa de «qué es» (P5): en F1 va siempre vacía (la llena `describe`, fuera de F1)
	readonly annotations: readonly never[];
};

export type CaptureSource = {
	readonly url: string;
	readonly viewport: Viewport;
	readonly screenScale: number;
	readonly devicePixelRatio: number;
	readonly capturedAt: string;
	readonly kit: typeof CAPTURE_KIT;
	readonly hooks: { readonly sha256: string } | null;
};

export type CaptureWarning = {
	readonly nodeId?: string | undefined;
	readonly message: string;
};

export type ScreenCapture = {
	readonly contract: typeof CONTRACT.capture;
	readonly screen: string;
	readonly title: string;
	readonly source: CaptureSource;
	readonly variants: readonly CaptureVariant[];
	readonly images: Readonly<Record<string, CaptureImage>>;
	readonly warnings: readonly CaptureWarning[];
};
