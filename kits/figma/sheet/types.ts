// Los datos que recibe el pintor de hojas (component@1): copia de domain/component-plan.ts y domain/sheets.ts (el kit no
// importa el servidor; un test pasa un plan real por el kit).
import type {
	Fingerprint,
	PlanImage,
	PlanMap,
	PlanNode,
} from "../screen/types.ts";

export type SheetStyle = {
	header: { fill: string; text: string };
	card: { fill: string };
	texts: {
		description: string;
		bug: string;
		tag: string;
		rowLabel: string;
		colLabel: string;
	};
	bug?: { prefix: string; setPrefix: string };
	matrix: { stroke: string };
};

// Una capa hecha a mano de las variantes: nombre, tipo, las propiedades que usa (sin `#id`) y en qué variantes está
export type HandMadeLayer = {
	name: string;
	type: string;
	properties: string[];
	variants: string[];
};

export type SetFingerprint = {
	variantProps: Record<string, string[]>;
	variants: string[];
	properties: string[];
	layers: HandMadeLayer[];
};

export type SheetDrift =
	| { decision: "figma" | "web"; fingerprint: SetFingerprint }
	| {
			decision: "map";
			values: Record<string, string>;
			fingerprint: SetFingerprint;
	  };

export type SheetEntry = {
	key: string;
	screen: string;
	title: string;
	page: { name: string; after?: string; section?: string };
	description: string;
	bug?: string;
	tag?: string;
	matrix?: { rows?: string[]; align?: "top" | "center" };
	texts?: { name: string; match: string }[];
	booleans?: { name: string; layer: string; on?: boolean }[];
	icons?: {
		icon: string;
		boolean?: string;
		swap?: string;
		on?: boolean;
		noBooleanWhen?: Record<string, string>;
	}[];
	slots?: { name: string; layer: string; boolean?: string }[];
	names?: { classes: string; name: string }[];
	exposed?: string[];
	flowIcons?: boolean;
	rules?: string[];
	keep?: string[];
	drift?: SheetDrift;
};

export type ComponentPlan = {
	contract: "component@1";
	sheet: SheetEntry;
	style: SheetStyle;
	sources: {
		capture: { path: string; sha256: string };
		sheets: { path: string; sha256: string };
		map: { path: string; sha256: string };
		recognize?: { sha256: string };
	};
	target: {
		page: { name: string; key: string; after?: string; section?: string };
		set: { name: string; key: string };
	};
	variants: { props: Record<string, string>; root: PlanNode[] }[];
	images: Record<string, PlanImage>;
	icons: Record<string, string>;
	map: PlanMap;
	fingerprints?: Record<string, Fingerprint>;
	rules?: string[];
	matrix: { rows: string[]; columns: string[]; cells: number[][] };
	warnings: { code: string; nodeId?: string; message: string }[];
};
