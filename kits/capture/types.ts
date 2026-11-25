// Lo que produce el kit en el navegador: el nodo de la captura con su `path`. Las
// imágenes salen como `data:`; el servidor las saca a ficheros por sha256, pone `ref` y el `id` (domain/node-id.ts).

export type Rgba = [number, number, number, number];
export type Box4 = [number, number, number, number];

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
	ws: string;
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

export type GradientStop = { c: Rgba; p: number };
export type Gradient =
	| { angle: number; stops: GradientStop[] }
	| { radial: true; stops: GradientStop[] };

// Un nodo tal como lo arma el kit: campos opcionales según su tipo (con nombres cortos)
export type RawNode = {
	t: "frame" | "text" | "svg" | "img" | "icon";
	path?: string;
	tag?: string;
	cls?: string;
	x?: number;
	y?: number;
	w: number;
	h: number;
	pos?: string;
	op?: number;
	top?: boolean;
	// marco
	disp?: string;
	dir?: string;
	wrap?: string;
	jc?: string;
	ai?: string;
	gap?: number;
	rgap?: number;
	pad?: Box4;
	bg?: Rgba | null;
	bw?: Box4;
	bc?: Rgba | null;
	bcb?: Rgba | null;
	rad?: Box4;
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
	kids?: RawNode[];
	// texto
	txt?: string;
	lines?: number;
	// svg
	svg?: string;
	key?: string;
	color?: Rgba | null;
	spin?: boolean;
	// imagen
	src?: string;
	data?: string;
	fit?: string;
	glyph?: string;
	// icono
	name?: string;
};

// Una variante capturada: sus props y el árbol
export type RawVariant = {
	props: Record<string, string>;
	nodes: RawNode[];
};
