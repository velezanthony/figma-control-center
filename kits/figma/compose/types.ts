// compose@1 tal como llega al kit en `params`. El kit no importa el servidor: un test cruza
// esta forma con el tipo del dominio (server/domain/compose.ts) al compilar.
export type ComposeSizing = "FIXED" | "HUG" | "FILL";

export type StackData = {
	stack: "VERTICAL" | "HORIZONTAL" | "GRID";
	gap?: string | undefined;
	padding?: string | readonly string[] | undefined;
	fill?: string | undefined;
	radius?: string | undefined;
	sizing?: { h: ComposeSizing; v: ComposeSizing } | undefined;
	name?: string | undefined;
	children: readonly BlockData[];
};

export type UseData = {
	use: string | { key: string };
	variant?: Readonly<Record<string, string>> | undefined;
	props?: Readonly<Record<string, string | boolean>> | undefined;
	slots?: Readonly<Record<string, readonly BlockData[]>> | undefined;
	name?: string | undefined;
};

export type TextData = {
	text: string;
	style: string;
	color?: string | undefined;
	name?: string | undefined;
};

export type OtherData =
	| { image: string; fit?: string | undefined; name?: string | undefined }
	| { icon: string; color?: string | undefined };

export type BlockData = StackData | UseData | TextData | OtherData;

export type ComposeData = {
	contract: "compose@1";
	key: string;
	title: string;
	target: {
		page: string;
		frame?: string | undefined;
		width: number;
		height?: number | undefined;
	};
	root: BlockData;
};

// De las hojas que usa el compose, su clave y el título con el que se busca su set cuando no lleva `fcc:sheet:`
export type SheetData = { key: string; title: string };

export type ComposeParams = { compose: ComposeData; sheets: SheetData[] };
