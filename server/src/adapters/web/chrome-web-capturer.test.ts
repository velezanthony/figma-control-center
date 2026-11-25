import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebCaptureRequest } from "#application/ports/web-capturer.ts";
import type { Screen } from "#domain/capture.ts";
import {
	type FigmaError,
	WEB_PAGE_REASON,
	webPageError,
} from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { CapturePage } from "./capture-page.ts";
import { captureScreen } from "./chrome-web-capturer.ts";

// Una pestaña de mentira: apunta lo que se le pide y contesta lo mínimo del kit
function fakePage(
	forceReply: (selector: string) => Result<true, FigmaError> = () =>
		ok(true as const),
) {
	const calls: string[] = [];
	const page = {
		navigate: async (path: string) => {
			calls.push(`navigate ${path}`);
			return ok(`http://web${path}`);
		},
		setViewport: async (v: { w: number; h: number }) => {
			calls.push(`viewport ${v.w}x${v.h}`);
			return ok(true as const);
		},
		kit: async (method: string) => {
			calls.push(`kit ${method}`);
			return ok(
				method === "capture" ? { nodes: [], warnings: [] } : { warnings: [] },
			);
		},
		click: async () => ok(true as const),
		evaluateInPage: async () => ok(true as const),
		until: async () => ok(true as const),
		force: async (forces: { selector: string; state: string }[]) => {
			calls.push(
				`force ${forces.map((f) => `${f.selector} ${f.state}`).join(", ")}`,
			);
			return forceReply(forces[0]?.selector ?? "");
		},
		clearForced: async () => {
			calls.push("clearForced");
			return ok(true as const);
		},
	};
	return { page: page as unknown as CapturePage, calls };
}

const request = (): WebCaptureRequest => ({
	web: {
		baseUrl: "http://web",
		viewport: { w: 1000, h: 700 },
		screenScale: 1,
		devicePixelRatio: 1,
		login: null,
		strip: [],
		hideScrollbar: true,
	},
	screens: [],
	users: new Map(),
	hooks: null,
	allowPageWorld: false,
	pageTimeoutMs: 1000,
});

const screen = (extra: Partial<Screen>): Screen => ({
	key: "cmp",
	title: "Cmp",
	url: "/g/x/raw/",
	...extra,
});

describe("captureScreen: query por variante y viewport por pantalla", () => {
	it("navega a la url de cada variante con su query, en su orden", async () => {
		const { page, calls } = fakePage();
		const r = await captureScreen(
			page,
			request(),
			screen({
				variants: [
					{ props: { a: "1" }, query: { size: "sm", label: "Hola mundo" } },
					{ props: { a: "2" }, query: { size: "lg" } },
					{ props: { a: "3" } },
				],
			}),
			true,
		);
		assert.ok(r.ok);
		assert.deepEqual(
			calls.filter((c) => c.startsWith("navigate")),
			[
				"navigate /g/x/raw/?size=sm&label=Hola+mundo",
				"navigate /g/x/raw/?size=lg",
				"navigate /g/x/raw/",
			],
		);
	});

	it("una pantalla con viewport lo fija antes de navegar y vuelve al del proyecto al acabar", async () => {
		const { page, calls } = fakePage();
		const r = await captureScreen(
			page,
			request(),
			screen({ viewport: { w: 240, h: 300 }, variants: [{ props: {} }] }),
			true,
		);
		assert.ok(r.ok);
		const flow = calls.filter(
			(c) => c.startsWith("viewport") || c.startsWith("navigate"),
		);
		assert.deepEqual(flow, [
			"viewport 240x300",
			"navigate /g/x/raw/",
			"viewport 1000x700",
		]);
	});

	it("una pantalla sin viewport no toca el de la pestaña", async () => {
		const { page, calls } = fakePage();
		await captureScreen(page, request(), screen({}), true);
		assert.equal(
			calls.some((c) => c.startsWith("viewport")),
			false,
		);
	});

	it("si la captura falla, el viewport también vuelve al del proyecto", async () => {
		const { page, calls } = fakePage();
		(page as unknown as { kit: () => Promise<unknown> }).kit = async () => ({
			ok: false,
			error: {
				type: "WebPageError",
				message: "x",
				retryable: true,
				nextStep: "",
			},
		});
		const r = await captureScreen(
			page,
			request(),
			screen({ viewport: { w: 240, h: 300 } }),
			true,
		);
		assert.equal(r.ok, false);
		assert.equal(calls.at(-1), "viewport 1000x700");
	});
});

describe("captureScreen: pseudoclases forzadas por variante", () => {
	const variants = [
		{ props: { state: "default" } },
		{
			props: { state: "hover" },
			force: [
				{ selector: "button", state: "hover" as const },
				{ selector: "button", state: "active" as const },
			],
		},
	];

	it("se fuerza tras las acciones y el until, antes de medir, y se quita al acabar la variante; una variante sin `force` no toca nada", async () => {
		const { page, calls } = fakePage();
		const r = await captureScreen(
			page,
			request(),
			screen({
				variants: [
					variants[0] as never,
					{
						...(variants[1] as object),
						until: "x",
						run: [{ click: "#a" }],
					} as never,
				],
			}),
			true,
		);
		assert.ok(r.ok);
		const second = calls.slice(calls.lastIndexOf("navigate /g/x/raw/"));
		assert.deepEqual(
			second.filter(
				(c) =>
					c.startsWith("force") || c === "clearForced" || c === "kit capture",
			),
			["force button hover, button active", "kit capture", "clearForced"],
		);
		assert.equal(calls.filter((c) => c.startsWith("force")).length, 1);
		assert.equal(calls.filter((c) => c === "clearForced").length, 1);
	});

	it("un selector que no existe corta la captura de la pantalla con ese error y no se mide", async () => {
		const { page, calls } = fakePage(() =>
			err(
				webPageError(
					WEB_PAGE_REASON.load,
					"no hay ningún elemento button donde forzar :hover",
				),
			),
		);
		const r = await captureScreen(
			page,
			request(),
			screen({ variants: variants as never }),
			true,
		);
		assert.ok(!r.ok);
		assert.match(JSON.stringify(r.error), /donde forzar :hover/);
		assert.equal(
			calls.filter((c) => c === "kit capture").length,
			1,
			"solo la variante sin force llegó a medir",
		);
	});
});

describe("captureScreen: viewport por variante", () => {
	it("cambia el tamaño de la pestaña solo cuando la variante pide otro, y al acabar vuelve al de project@1", async () => {
		const { page, calls } = fakePage();
		const r = await captureScreen(
			page,
			request(),
			screen({
				viewport: { w: 240, h: 800 },
				variants: [
					{ props: { a: "1" } },
					{ props: { a: "2" }, viewport: { w: 375, h: 700 } },
					{ props: { a: "3" }, viewport: { w: 375, h: 700 } },
					{ props: { a: "4" } },
				],
			}),
			true,
		);
		assert.ok(r.ok);
		assert.deepEqual(
			calls.filter((c) => c.startsWith("viewport")),
			[
				"viewport 240x800",
				"viewport 375x700",
				"viewport 240x800",
				"viewport 1000x700",
			],
		);
	});

	it("sin viewport en la pantalla, una variante con el suyo vuelve al de project@1 al acabar", async () => {
		const { page, calls } = fakePage();
		await captureScreen(
			page,
			request(),
			screen({
				variants: [
					{ props: { a: "1" }, viewport: { w: 375, h: 700 } },
					{ props: { a: "2" } },
				],
			}),
			true,
		);
		assert.deepEqual(
			calls.filter((c) => c.startsWith("viewport")),
			["viewport 375x700", "viewport 1000x700"],
		);
	});
});
