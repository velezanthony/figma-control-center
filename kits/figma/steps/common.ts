// Lo común de los pasos de área: los datos que llegan como `params`, lo que se comprueba antes de escribir
// y cómo se busca un frame de un área (por clave; la primera vez por nombre, D-4).
import { fail, note } from "../core.ts";
import { nodeByKey, tagNode } from "../nodes.ts";
import { findPage } from "../pages.ts";
import {
	AREA_KEY_PREFIX,
	type FrameNode,
	type PageNode,
	SHARED_KEY_PREFIX,
} from "../types.ts";

// Los datos de areas@1 que el servidor pasa a cada paso (el kit no importa el servidor: un test cruza la forma)
export type Clickable = {
	names: string[];
	namePrefixes: string[];
	components: string[];
	parts?: { name: string; insideComponent: string }[];
};
export type LinkRules = {
	clickable: Clickable;
	rows: { row: string[]; body: string[] };
	transition: { type: string; easing: string; duration: number };
};
export type AreaData = {
	name: string;
	page: string;
	frame: { width: number; minHeight: number; fill?: string; clip?: boolean };
	place: {
		mode: "replace-content" | "transplant";
		source: {
			pagePrefix: string;
			take: "first-variant" | "first-component" | "first-frame";
			remove?: boolean;
		};
		unwrap?: { holding: string[] };
		keep?: string[];
		drop?: string[];
		strokeScale?: number;
	};
	shell?: {
		set: string;
		in: string[];
		variantProp: string;
		default: string;
		fixed?: { height: number };
	};
	main?: string[];
	screens: { frame: string; screen?: string; shell?: string }[];
	clickable?: Clickable;
	links?: (
		| {
				from: string;
				text: string;
				match?: "exact" | "start" | "contains";
				to: string;
		  }
		| { from: string; rows: true; to: string }
	)[];
	flowStart?: { frame: string; name: string };
	fills?: {
		frame: string;
		find: { text: string; minSize: [number, number] };
		asset: string;
		name?: string;
	}[];
};
export type SharedData = {
	name: string;
	set: string;
	page: { name: string; after?: string };
	part: string[];
	variantProp: string;
	from: { area: string; frame: string; value: string }[];
	sheet?: { gap: number; padding: number };
};
export type AreaParams = {
	area: AreaData;
	linkRules: LinkRules;
	shared: SharedData[];
};

export const areaFrameKey = (area: string, frame: string): string =>
	`${AREA_KEY_PREFIX}${area}/${frame}`;
export const sharedGroupKey = (name: string): string =>
	`${SHARED_KEY_PREFIX}${name}`;

export const messageOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// Falta algo en Figma: se dice todo junto y no se ha escrito nada
export function notFound(missing: readonly string[]): never {
	return fail(
		"AREA_NOT_FOUND",
		`En Figma falta: ${missing.join("; ")}.`,
		"Crea o renombra lo que falta en Figma (o corrige areas@1) y repite el paso: no se ha tocado nada.",
	);
}

export async function requirePage(area: AreaData): Promise<PageNode> {
	const page = await findPage(area.page);
	if (page === null) notFound([`la página «${area.page}»`]);
	return page;
}

// El frame de un área por su clave; si no la tiene, el que se llama así en la página (y se le pone la clave, ADOPTED)
export async function findAreaFrame(
	area: AreaData,
	page: PageNode,
	name: string,
): Promise<FrameNode | null> {
	const key = areaFrameKey(area.name, name);
	const byKey = await nodeByKey(key, { page });
	if (byKey !== null && byKey.type === "FRAME") return byKey;
	const byName = page.children.find(
		(c) => c.type === "FRAME" && c.name === name,
	);
	if (byName === undefined || byName.type !== "FRAME") return null;
	tagNode(byName, key);
	note.warn(
		"ADOPTED",
		`El frame «${name}» no tenía clave: se ha adoptado por su nombre.`,
		byName.id,
	);
	return byName;
}
