// Los pasos del kit (kit/<paso>@1): `kit.steps.*` los llama el código fijo que el servidor envía para un paso `use`, siempre
// con `(params, assets)`; los que no usan imágenes ignoran `assets`
import { buildComponent, type SheetParams } from "./build-component.ts";
import { buildScreen, type ScreenParams } from "./build-screen.ts";
import type { AreaParams } from "./common.ts";
import { type ComposeParams, compose } from "./compose.ts";
import { fillImage } from "./fill-image.ts";
import { layoutCheck } from "./layout-check.ts";
import { links } from "./links.ts";
import { place } from "./place.ts";
import { share } from "./share.ts";

type Assets = Readonly<Record<string, Uint8Array>>;

export const steps = Object.freeze({
	buildComponent: (params: SheetParams, assets: Assets, recognize?: unknown) =>
		buildComponent(params, assets, recognize),
	buildScreen: (params: ScreenParams, assets: Assets, recognize?: unknown) =>
		buildScreen(params, assets, recognize),
	compose: (params: ComposeParams, _assets?: Assets) => compose(params),
	place: (params: AreaParams, _assets?: Assets) => place(params),
	share: (params: AreaParams, _assets?: Assets) => share(params),
	links: (params: AreaParams, _assets?: Assets) => links(params),
	layoutCheck: (params: AreaParams, _assets?: Assets) => layoutCheck(params),
	fillImage: (params: AreaParams, assets: Assets) => fillImage(params, assets),
});
