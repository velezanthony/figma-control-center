// El estado de una pintada: los avisos y los índices de
// variables, estilos e iconos, en un objeto que se crea al empezar el paso y se tira al acabar.
import { figmaApi, note } from "../core.ts";
import { checkRecognize } from "../recognize/module.ts";
import { createRecognizer, type Recognizer } from "../recognize/rules.ts";
import { loadTokens } from "../tokens.ts";
import type { ComponentNode, EffectStyle, SceneNode } from "../types.ts";
import { createPaintResolver, type PaintResolver } from "./color.ts";
import { createTextKit, type TextKit } from "./fonts.ts";
import type { Counters, PlanNode, ScreenPlan } from "./types.ts";

export type Ctx = {
	plan: ScreenPlan;
	assets: Readonly<Record<string, Uint8Array>>;
	// El nodo de Figma → el nodo capturado que lo originó (para medir y corregir posiciones)
	km: Map<SceneNode, PlanNode>;
	// Dentro de un contenedor que recorta (mapa): un absoluto no desplaza a sus hermanos
	clip: number;
	counters: Counters;
	paint: PaintResolver;
	text: TextKit;
	effects: Map<string, EffectStyle>;
	effectPattern: RegExp | null;
	icons: Map<string, ComponentNode>;
	// Los hashes de las imágenes ya creadas: mismos bytes, mismo hash
	hashes: Map<string, string>;
	// Un aviso con su código, una sola vez por código y texto
	warn(code: string, message: string, nodeId?: string): void;
	// F4b: reglas del proyecto y huellas; null si la pantalla no reconoce nada
	recognizer: Recognizer | null;
	// Hojas de componentes (META.names): nombre de capa por una clase del nodo (substring), antes que el rol
	layerNames: readonly { classes: string; name: string }[];
	// Hojas de componentes: el título del propio set; si su huella es la mejor, no se instancia
	ownTitle: string | null;
};

export async function createCtx(
	plan: ScreenPlan,
	assets: Readonly<Record<string, Uint8Array>>,
	// El módulo recognize@1 del proyecto, ya como objeto (llega dentro del código del paso); null si no lo hay
	recognize: unknown = null,
): Promise<Ctx> {
	// Un módulo que no tiene la forma para el paso ANTES de escribir nada
	const module = recognize === null ? null : checkRecognize(recognize);
	const counters: Counters = {
		nodes: 0,
		images: 0,
		icons: 0,
		components: {},
		moved: [],
		wrapped: [],
		untokenized: new Map(),
		matches: [],
	};
	// Las colecciones que faltan paran el paso aquí, antes de escribir nada (COLLECTION_NOT_FOUND)
	const tokens = await loadTokens(plan.map.tokens.collections);
	const paint = createPaintResolver(tokens, plan.map.tokens, (color) =>
		counters.untokenized.set(color, (counters.untokenized.get(color) ?? 0) + 1),
	);
	const text = await createTextKit(plan.map.fonts, plan);

	const effects = new Map<string, EffectStyle>();
	if (plan.map.effects !== undefined) {
		for (const s of await figmaApi().getLocalEffectStylesAsync())
			effects.set(s.name, s);
	}

	// Las páginas de iconos se cargan una vez por paso
	const icons = new Map<string, ComponentNode>();
	const pages = new RegExp(plan.map.icons.pages);
	for (const page of figmaApi().root.children) {
		if (!pages.test(page.name)) continue;
		await page.loadAsync();
		for (const c of page.findAllWithCriteria({ types: ["COMPONENT"] })) {
			icons.set(c.name.replace(plan.map.icons.prefix, ""), c);
		}
	}

	const warned = new Set<string>();
	const ctx: Ctx = {
		plan,
		assets,
		km: new Map(),
		clip: 0,
		counters,
		paint,
		text,
		effects,
		effectPattern:
			plan.map.effects === undefined
				? null
				: new RegExp(plan.map.effects.classPattern),
		icons,
		hashes: new Map(),
		warn(code, message, nodeId) {
			const key = `${code}\u0000${message}`;
			if (warned.has(key)) return;
			warned.add(key);
			note.warn(code, message, nodeId);
		},
		recognizer: null,
		layerNames: [],
		ownTitle: null,
	};
	ctx.recognizer = await createRecognizer(ctx, module);
	return ctx;
}
