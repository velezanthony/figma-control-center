// kit/build-screen@1: el plan de una pantalla (screen@1, que arma el servidor desde la captura de
// la web) pintado en su página temporal.  El marco queda suelto, listo para
// `kit/place@1` (que lee la página `pagePrefix + frame` y toma su primer marco).
import { fail, figmaApi, note, startTracking } from "../core.ts";
import { readJson } from "../json.ts";
import { tagNode } from "../nodes.ts";
import { ensurePage } from "../pages.ts";
import { createCtx } from "../screen/ctx.ts";
import { paintRoots } from "../screen/roots.ts";
import type { ScreenPlan } from "../screen/types.ts";
import type { PageNode } from "../types.ts";

export type ScreenParams = {
	screen: string;
	area?: string;
	frame?: string;
	variant: number;
};

const MAX_UNTOKENIZED_WARNINGS = 20;
const MAX_MOVED_SHOWN = 12;
const MAX_WRAPPED_SHOWN = 6;

function readPlan(
	assets: Readonly<Record<string, Uint8Array>>,
	screen: string,
): ScreenPlan {
	const bytes = assets["plan"];
	if (bytes === undefined) {
		return fail(
			"PLAN_MISSING",
			"El paso no recibió el asset `plan`.",
			"Lanza el paso con figma_build (el servidor arma el plan); no lo llames a mano sin `plan`.",
		);
	}
	const plan = readJson(bytes) as ScreenPlan;
	if (plan.contract !== "screen@1" || plan.screen !== screen) {
		return fail(
			"PLAN_INVALID",
			`El plan no es un screen@1 de «${screen}» (trae ${String(plan.contract)} de «${String(plan.screen)}»).`,
			"Repite el paso con figma_build: el servidor vuelve a armar el plan desde la última captura.",
		);
	}
	if (plan.root.length === 0) {
		return fail(
			"PLAN_EMPTY",
			`La variante ${plan.variant} de «${screen}» no tiene nodos que pintar.`,
			"Captura la pantalla otra vez con figma_capture o elige otra variante.",
		);
	}
	return plan;
}

// La página de la pantalla: la de su clave, o una nueva tras la que dice `after`. Se vacía: repetir el paso pinta lo mismo
async function pageFor(plan: ScreenPlan): Promise<PageNode> {
	const f = figmaApi();
	const before = f.root.children.length;
	const page = await ensurePage({
		key: plan.target.page.key,
		name: plan.target.page.name,
	});
	const after = plan.target.page.after;
	if (f.root.children.length > before && after !== undefined) {
		const index = f.root.children.findIndex(
			(p) => p.name.trim() === after.trim(),
		);
		if (index >= 0) f.root.insertChild(index + 1, page);
		else {
			note.warn(
				"PAGE_AFTER_NOT_FOUND",
				`No hay página «${after}»: «${page.name}» queda al final.`,
				page.id,
			);
		}
	}
	await f.setCurrentPageAsync(page);
	// Lo pintado se rehace; los componentes y sets que viven en esa página (la bandera que reconoce una regla, por ejemplo) no se
	// tocan: borrarlos rompería sus instancias
	const old = page.children.filter(
		(c) => c.type !== "COMPONENT_SET" && c.type !== "COMPONENT",
	);
	note.removed(old);
	for (const child of old) child.remove();
	return page;
}

export async function buildScreen(
	params: ScreenParams,
	assets: Readonly<Record<string, Uint8Array>>,
	// recognize@1: el módulo del proyecto como objeto (o null)
	recognize?: unknown,
) {
	const tracker = startTracking();
	const plan = readPlan(assets, params.screen);
	for (const w of plan.warnings) {
		note.warn(
			w.code,
			w.nodeId === undefined
				? w.message
				: `${w.message} (nodo ${w.nodeId} de la captura)`,
		);
	}
	// Lo que falta en Figma (colecciones, fuentes) para el paso AQUÍ, antes de escribir nada
	const ctx = await createCtx(plan, assets, recognize ?? null);
	const page = await pageFor(plan);
	const root = await paintRoots(ctx);
	ctx.recognizer?.flush();
	page.appendChild(root);
	root.name = plan.target.frame.name;
	note.created(root);
	tagNode(root, plan.target.frame.key);

	const total = (list: readonly string[]) => list.length;
	for (const [color, times] of [...ctx.counters.untokenized].slice(
		0,
		MAX_UNTOKENIZED_WARNINGS,
	)) {
		note.warn(
			"TOKEN_UNTOKENIZED",
			`El color #${color} (${times} ${times === 1 ? "vez" : "veces"}) no tiene variable: se pinta suelto.`,
		);
	}
	const { counters } = ctx;
	return tracker.done({
		screen: params.screen,
		page: page.name,
		frameId: root.id,
		nodes: counters.nodes,
		images: counters.images,
		icons: counters.icons,
		instances: counters.components,
		matches: counters.matches,
		moved: [...new Set(counters.moved)].slice(0, MAX_MOVED_SHOWN),
		movedCount: total(counters.moved),
		wrapped: [...new Set(counters.wrapped)].slice(0, MAX_WRAPPED_SHOWN),
		wrappedCount: total(counters.wrapped),
		untokenized: [...counters.untokenized.values()].reduce((a, b) => a + b, 0),
	});
}
