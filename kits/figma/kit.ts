// El kit de Figma (figma-kit@1): piezas con nombre que el servidor instala en la pestaña y pasa a cada paso como `kit`.
// Cada pieza resuelve una trampa del API de plugins; las que crean, cambian o borran avisan al `track()` del paso en curso.
import {
	cloneVariant,
	findComponent,
	pickVariant,
	setNameOf,
} from "./components.ts";
import { fail, startTracking } from "./core.ts";
import { startFlow } from "./flow.ts";
import { ensureFonts, loadFonts } from "./fonts.ts";
import { ensureFrame, replaceContent } from "./frames.ts";
import { iconFromSvg } from "./icons.ts";
import { createInstance } from "./instances.ts";
import { readJson } from "./json.ts";
import { byText, capture, linkTo, restore, rows } from "./links.ts";
import { getNode, nodeByKey, tagNode } from "./nodes.ts";
import { ensurePage, findPage, removePage } from "./pages.ts";
import { setPaints } from "./paints.ts";
import { createPaintResolver, layerRole, paintScreen } from "./screen/index.ts";
import { assessPlan } from "./sheet/drift.ts";
import { paintSheet } from "./sheet/index.ts";
import { fillSlot, shareSlot } from "./slots.ts";
import { steps } from "./steps/index.ts";
import { loadTokens } from "./tokens.ts";
import { KIT_SHA_GLOBAL, KIT_VERSION } from "./types.ts";

export function createKit() {
	const sha = (globalThis as unknown as Record<string, unknown>)[
		KIT_SHA_GLOBAL
	];
	return Object.freeze({
		version: KIT_VERSION,
		sha256: typeof sha === "string" ? sha : null,
		track: startTracking,
		fail,
		page: Object.freeze({
			find: findPage,
			ensure: ensurePage,
			remove: removePage,
		}),
		node: Object.freeze({ get: getNode, tag: tagNode, byKey: nodeByKey }),
		frame: Object.freeze({ ensure: ensureFrame, replaceContent }),
		links: Object.freeze({ capture, restore, to: linkTo, byText, rows }),
		flow: Object.freeze({ start: startFlow }),
		component: Object.freeze({
			find: findComponent,
			setNameOf,
			variant: pickVariant,
			cloneVariant,
		}),
		instance: Object.freeze({ create: createInstance }),
		slot: Object.freeze({ fill: fillSlot, share: shareSlot }),
		fonts: Object.freeze({ ensure: ensureFonts, load: loadFonts }),
		tokens: Object.freeze({
			load: loadTokens,
			resolver: createPaintResolver,
			// El relleno o borde de un color: ligado a su variable si la hay (la de la clase del nodo o de sus antecesores)
			paint: (
				resolver: ReturnType<typeof createPaintResolver>,
				color: readonly [number, number, number, number],
				chain: readonly string[],
				kind: Parameters<
					ReturnType<typeof createPaintResolver>["paint"]
				>[2] = "fill",
			) => resolver.paint(color, chain, kind),
		}),
		layers: Object.freeze({ role: layerRole }),
		screen: Object.freeze({ paint: paintScreen }),
		sheet: Object.freeze({ paint: paintSheet, assess: assessPlan }),
		paints: Object.freeze({ set: setPaints }),
		icons: Object.freeze({ fromSvg: iconFromSvg }),
		json: readJson,
		steps,
	});
}

export type FigmaKit = ReturnType<typeof createKit>;
