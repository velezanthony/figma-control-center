// kit.screen.paint: el plan de una pantalla → su marco en Figma, en la página abierta. Lo llama el paso `kit/build-screen@1`
// y cualquier script del proyecto que quiera pintar un plan por su cuenta.

import type { SceneNode } from "../types.ts";
import { type Ctx, createCtx } from "./ctx.ts";
import { paintRoots } from "./roots.ts";
import type { ScreenPlan } from "./types.ts";

export type Painted = { root: SceneNode; ctx: Ctx };

export async function paintScreen(
	plan: ScreenPlan,
	assets: Readonly<Record<string, Uint8Array>>,
	// recognize@1: el módulo del proyecto como objeto (o null)
	recognize?: unknown,
): Promise<Painted> {
	const ctx = await createCtx(plan, assets, recognize ?? null);
	const root = await paintRoots(ctx);
	ctx.recognizer?.flush();
	return { root, ctx };
}

export {
	createPaintResolver,
	type PaintKind,
	type PaintResolver,
} from "./color.ts";
export { layerRole } from "./layers.ts";
export type { ScreenPlan } from "./types.ts";
