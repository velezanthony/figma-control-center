// kit/compose@1: un compose@1 pintado en Figma sin web previa, solo con instancias de hojas,
// variables y estilos. El frame se busca por la clave `fcc:compose:<clave>` en la página del target y se rehace: repetir el paso
// no duplica. Todo lo que el compose nombra se resuelve ANTES de escribir (si falta algo no se toca el lienzo).

import { applyStack, type PaintCtx, paintBlock } from "../compose/paint.ts";
import { resolveNeeds } from "../compose/resolve.ts";
import type { ComposeParams, StackData } from "../compose/types.ts";
import { fail, figmaApi, note, startTracking } from "../core.ts";
import { nodeByKey, tagNode } from "../nodes.ts";
import { findPage } from "../pages.ts";
import {
	composeKey,
	composePageKey,
	type FrameNode,
	type PageNode,
} from "../types.ts";

export type { ComposeParams };

// La altura con la que nace un frame que se ajusta al contenido: Figma la recalcula al ponerle auto-layout
const INITIAL_HEIGHT = 100;
// Hueco entre un frame nuevo y lo que ya había en la página
const FRAME_GAP = 80;

async function pageFor(
	name: string,
	key: string,
): Promise<{ page: PageNode; created: boolean }> {
	const found = await findPage(name);
	if (found !== null) return { page: found, created: false };
	const page = figmaApi().createPage();
	page.name = name;
	tagNode(page, key);
	note.created(page);
	return { page, created: true };
}

// Un frame nuevo va a la derecha de lo que ya hay en la página, sin pisarlo
const nextFree = (page: PageNode): number =>
	page.children.reduce(
		(edge, c) => Math.max(edge, c.x + c.width + FRAME_GAP),
		0,
	);

async function frameFor(
	page: PageNode,
	key: string,
	width: number,
): Promise<{ frame: FrameNode; existing: boolean }> {
	const existing = await nodeByKey(key, { page });
	if (existing !== null) {
		if (existing.type === "FRAME") return { frame: existing, existing: true };
		return fail(
			"KEY_NOT_FRAME",
			`La clave «${key}» ya la tiene un nodo de tipo ${existing.type}, no un marco.`,
			"Quita la clave del otro nodo o usa otra clave de compose.",
		);
	}
	const frame = figmaApi().createFrame();
	frame.layoutMode = "VERTICAL";
	frame.resize(width, INITIAL_HEIGHT);
	frame.x = nextFree(page);
	frame.y = 0;
	page.appendChild(frame);
	tagNode(frame, key);
	note.created(frame);
	return { frame, existing: false };
}

// El stack de la raíz va sobre el propio frame; una raíz que no es un stack (una hoja, un texto) entra como su único hijo en
// un frame vertical vacío
const asStack = (root: ComposeParams["compose"]["root"]): StackData =>
	"stack" in root ? root : { stack: "VERTICAL", children: [root] };

export async function compose(params: ComposeParams) {
	const tracker = startTracking();
	const { compose: data } = params;
	const resolved = await resolveNeeds(params);

	const { page, created: pageCreated } = await pageFor(
		data.target.page,
		composePageKey(data.key),
	);
	const { frame, existing } = await frameFor(
		page,
		composeKey(data.key),
		data.target.width,
	);
	try {
		const removed = [...frame.children];
		note.removed(removed);
		for (const child of removed) child.remove();

		const root = asStack(data.root);
		if ("stack" in data.root && data.root.sizing !== undefined) {
			note.warn(
				"ROOT_SIZING_IGNORED",
				"El `sizing` del stack raíz no vale: el ancho lo manda `target.width` y el alto, `target.height` (o el contenido).",
				frame.id,
			);
		}
		frame.name = data.target.frame ?? data.title;
		const ctx: PaintCtx = {
			...resolved,
			root: frame,
			used: {},
			texts: 0,
			frames: 0,
			slots: 0,
		};
		applyStack(frame, root, ctx);
		// El ancho es del target; el alto, del target o del contenido. Los modos van DESPUÉS de `resize`, que los deja fijos
		const heightMode = data.target.height === undefined ? "AUTO" : "FIXED";
		const vertical = root.stack === "VERTICAL";
		frame.resize(data.target.width, data.target.height ?? frame.height);
		frame.primaryAxisSizingMode = vertical ? heightMode : "FIXED";
		frame.counterAxisSizingMode = vertical ? "FIXED" : heightMode;
		for (const child of root.children) await paintBlock(child, frame, ctx);
		note.mutated(frame);

		return tracker.done({
			compose: data.key,
			page: page.name,
			pageId: page.id,
			frameId: frame.id,
			rebuilt: existing,
			frames: ctx.frames,
			texts: ctx.texts,
			instances: ctx.used,
			slots: ctx.slots,
		});
	} catch (e) {
		// Un frame que este paso acaba de crear no se deja a medias; uno que ya existía queda como esté (se repite el paso)
		if (!existing) {
			note.removed(frame);
			frame.remove();
			if (pageCreated) {
				note.removed(page);
				page.remove();
			}
		}
		throw e;
	}
}
