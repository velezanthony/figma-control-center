// El capturador de serie: solo compone piezas. Lo que corre en la página, en el mundo aislado:
// `ready` (settle → gancho ready → strip), `click` y `capture` (fondos → walk con isVisible + ignore + node → rutas). El
// servidor (adapters/web) navega, ejecuta las acciones de la variante y sondea `until` entre una llamada y otra.
import { gradient, luminance, px, shadows, splitTop } from "./parse.ts";
import type { KitEnv } from "./pieces.ts";
import * as pieces from "./pieces.ts";
import { backgrounds, settle, sleep, strip, until } from "./settle.ts";
import type { RawNode } from "./types.ts";
import { createValues } from "./values.ts";
import { makeNode, paths, roots, walk } from "./walk.ts";

export const CAPTURE_KIT = "capture-kit@1";
// El contrato del módulo de ganchos de un proyecto
export const HOOKS_CONTRACT = "capture@1";

export type CaptureTarget = {
	readonly screen: {
		readonly key: string;
		readonly title: string;
		readonly url: string;
	};
	readonly variant: { readonly props: Readonly<Record<string, string>> };
	readonly allowPageWorld: boolean;
};

export type ReadyOptions = CaptureTarget & {
	readonly strip: readonly string[];
	readonly hideScrollbar: boolean;
	readonly imgTimeoutMs: number;
};

export type CaptureOptions = CaptureTarget & {
	readonly pick?: string | undefined;
	readonly imgHi: boolean;
};

export type HookContext = {
	readonly kit: typeof KIT_PIECES;
	readonly page: {
		readonly document: Document;
		readonly window: Window;
		readonly url: string;
		readonly evaluateInPage?: (expression: string) => unknown;
	};
	readonly screen: CaptureTarget["screen"];
	readonly variant: CaptureTarget["variant"];
};

export type Hooks = {
	readonly prepare?: (ctx: HookContext) => unknown;
	readonly ready?: (ctx: HookContext) => unknown;
	readonly ignore?: (el: Element, ctx: HookContext) => unknown;
};

export type Warning = { readonly message: string };

// Las piezas con nombre que ven los ganchos (ctx.kit) y los tests
export const KIT_PIECES = {
	px,
	luminance,
	shadows,
	gradient,
	splitTop,
	...pieces,
	settle,
	backgrounds,
	strip,
	until,
	sleep,
	makeNode,
	roots,
	walk,
	paths,
	createValues,
} as const;

const HOOK_NAMES = ["prepare", "ready", "ignore"] as const;

export function createCapturer(win: Window) {
	const doc = win.document;
	const values = createValues(doc);
	let hooks: Hooks = {};

	// En el mundo de la página: un <script> en línea corre allí aunque lo inserte el mundo aislado; el resultado vuelve
	// por un atributo del documento. Solo existe con allowPageWorld (D-2)
	const evaluateInPage = (expression: string): unknown => {
		const attr = `data-capture-kit-${Math.random().toString(36).slice(2)}`;
		const s = doc.createElement("script");
		s.textContent = `document.documentElement.setAttribute(${JSON.stringify(attr)}, JSON.stringify((() => (${expression}))() ?? null))`;
		doc.documentElement.appendChild(s);
		s.remove();
		const raw = doc.documentElement.getAttribute(attr);
		doc.documentElement.removeAttribute(attr);
		return raw === null ? undefined : JSON.parse(raw);
	};

	const ctxFor = (t: CaptureTarget): HookContext => ({
		kit: KIT_PIECES,
		page: {
			document: doc,
			window: win,
			url: win.location.href,
			...(t.allowPageWorld ? { evaluateInPage } : {}),
		},
		screen: t.screen,
		variant: t.variant,
	});

	return {
		contract: CAPTURE_KIT,
		pieces: KIT_PIECES,

		// El módulo de ganchos del proyecto: { contract: "capture@1", hooks: { prepare?, ready?, ignore? } }
		useHooks(module: unknown): string | null {
			const m = module as { contract?: unknown; hooks?: unknown } | null;
			if (!m || typeof m !== "object" || m.contract !== HOOKS_CONTRACT)
				return `el módulo de ganchos no es { contract: "${HOOKS_CONTRACT}", hooks }`;
			const h = (m.hooks ?? {}) as Record<string, unknown>;
			const unknownHook = Object.keys(h).find(
				(k) =>
					!(HOOK_NAMES as readonly string[]).includes(k) ||
					typeof h[k] !== "function",
			);
			if (unknownHook !== undefined)
				return `gancho desconocido o que no es una función: «${unknownHook}» (valen ${HOOK_NAMES.join(", ")})`;
			hooks = h as Hooks;
			return null;
		},

		// Una vez por captura, en la primera página y tras el login
		async prepare(t: CaptureTarget): Promise<void> {
			await hooks.prepare?.(ctxFor(t));
		},

		// Tras cargar cada variante: settle → ready → strip
		async ready(o: ReadyOptions): Promise<{ readonly warnings: Warning[] }> {
			const env: KitEnv = { win, doc, v: values, bg: new Map(), imgHi: true };
			const { pendingImages } = await settle(env, {
				imgTimeoutMs: o.imgTimeoutMs,
			});
			await hooks.ready?.(ctxFor(o));
			strip(doc, o.strip, o.hideScrollbar);
			const warnings: Warning[] = [];
			if (pendingImages > 0)
				warnings.push({
					message: `${pendingImages} imágenes sin cargar al acabar la espera`,
				});
			return { warnings };
		},

		// Un clic en el DOM (llega a la app aunque se lance desde el mundo aislado)
		click(selector: string): boolean {
			const el = doc.querySelector(selector);
			if (!el) return false;
			(el as HTMLElement).click();
			return true;
		},

		async capture(o: CaptureOptions): Promise<{
			readonly nodes: RawNode[];
			readonly warnings: Warning[];
		}> {
			const env: KitEnv = {
				win,
				doc,
				v: values,
				bg: new Map(),
				imgHi: o.imgHi,
			};
			await backgrounds(env);
			win.scrollTo(0, 0);
			const ctx = ctxFor(o);
			const ignore = hooks.ignore;
			const node = makeNode(
				env,
				ignore ? (el) => !!ignore(el, ctx) : () => false,
			);
			const elements = roots(doc, o.pick);
			const warnings: Warning[] = [];
			if (o.pick && elements.length === 0)
				warnings.push({
					message: `pick «${o.pick}» no encuentra ningún elemento`,
				});
			return { nodes: walk(elements, node), warnings };
		},
	};
}

export type Capturer = ReturnType<typeof createCapturer>;
