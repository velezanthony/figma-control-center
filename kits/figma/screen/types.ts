// Los datos que recibe el pintor (screen@1) y el estado de una pintada. El kit no importa el servidor: estos tipos son una
// copia de domain/screen-plan.ts y domain/capture.ts (un test pasa un plan real por el kit).
export type Rgba = readonly [number, number, number, number];
export type Box4 = readonly [number, number, number, number];

export type Font = {
	fam: string;
	size: number;
	weight: string;
	lh: string;
	ls: string;
	tt: string;
	td: string;
	fs: string;
	ta: string;
	ws?: string;
	color: Rgba | null;
};

export type Shadow = {
	c: Rgba;
	x: number;
	y: number;
	b: number;
	s: number;
	inset: boolean;
};

export type Gradient =
	| { angle: number; stops: { c: Rgba; p: number }[]; radial?: undefined }
	| { radial: true; stops: { c: Rgba; p: number }[]; angle?: undefined };

// El nodo de capture@1 tal cual; el pintor lo muta (grow, noPos, desplazamientos)
export type PlanNode = {
	id: string;
	path: string;
	t: "frame" | "text" | "svg" | "img" | "icon";
	tag?: string;
	cls?: string;
	x?: number;
	y?: number;
	w: number;
	h: number;
	pos?: string;
	op?: number;
	top?: boolean;
	// frame
	disp?: string;
	dir?: string;
	wrap?: string;
	jc?: string;
	ai?: string;
	gap?: number;
	rgap?: number;
	pad?: number[];
	bg?: Rgba | null;
	bw?: number[];
	bc?: Rgba | null;
	bcb?: Rgba | null;
	rad?: number[];
	sh?: string;
	shs?: Shadow[];
	fl?: string;
	ov?: string;
	ml?: number;
	mr?: number;
	font?: Font;
	va?: string;
	grad?: Gradient | null;
	fg?: number;
	kids?: PlanNode[];
	// texto
	txt?: string;
	lines?: number;
	// svg
	svg?: string;
	key?: string;
	color?: Rgba | null;
	spin?: boolean;
	// imagen
	ref?: string;
	src?: string;
	fit?: string;
	glyph?: string;
	// icono
	name?: string;
	// del pintor
	grow?: boolean;
	noPos?: boolean;
};

export type PlanImage = {
	asset: string;
	width: number;
	height: number;
	type: "png" | "jpeg";
	tooLarge?: boolean;
};

export type PlanMap = {
	tokens: {
		collections: string[];
		classPrefixes: {
			fill: string[];
			text: string[];
			stroke: string[];
			svg?: string[];
		};
		classToVariable: { from: string; to: string }[];
		fallback?: { collection: string };
		numbers?: {
			radius?: { prefix: string; full?: string };
			spacing?: { prefix: string };
		};
	};
	fonts: {
		families: { match: string; family: string }[];
		default: string;
		styles: Record<string, string>;
		italic: { suffix: string };
		strict?: string[];
		fallback?: string;
	};
	effects?: { classPattern: string };
	icons: {
		pages: string;
		prefix: string;
		glyphs?: { classPattern: string; prefix: string };
	};
	layers: { roles: Record<string, string>; textPrefix: boolean };
	screen?: { background?: string };
	// F4b: las clases de maquetación que no identifican un componente (expresiones regulares sobre la clase entera)
	components?: { genericClasses: string[] };
};

// Una huella de componente (fingerprints.json del proyecto): etiqueta, clases fijas de la raíz, firma y clases condicionales
export type FingerprintSig = { tag: string; cls: string[] };
export type Fingerprint = {
	title: string;
	tag: string;
	cls: string[];
	opt?: string[];
	cond?: Record<string, [string, string]>;
	defaults?: Record<string, string>;
	alias?: Record<string, string>;
	sig?: FingerprintSig | null;
	sig_cond?: FingerprintSig | null;
};

export type ScreenPlan = {
	contract: "screen@1";
	screen: string;
	title: string;
	variant: number;
	props: Record<string, string>;
	sources: {
		capture: { path: string; sha256: string };
		map: { path: string; sha256: string };
		recognize?: { sha256: string };
	};
	target: {
		page: { name: string; key: string; after?: string };
		frame: { name: string; key: string };
	};
	root: PlanNode[];
	images: Record<string, PlanImage>;
	icons: Record<string, string>;
	map: PlanMap;
	// F4b: solo las huellas de los componentes hoja, y las reglas que se prueban en esta pantalla
	fingerprints?: Record<string, Fingerprint>;
	rules?: string[];
	warnings: { code: string; nodeId?: string; message: string }[];
};

// Lo que se mide de una pintada y va al informe del paso
export type Counters = {
	nodes: number;
	images: number;
	icons: number;
	components: Record<string, number>;
	moved: string[];
	wrapped: string[];
	untokenized: Map<string, number>;
	// Qué nodo de la captura se cambió por qué instancia y por qué regla (`rule:<set>` o `fingerprint`)
	matches: { node: string; set: string; by: string }[];
};
