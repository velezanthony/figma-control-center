// El kit de captura (capture-kit@1) por página de ejemplo: cada página de
// server/test/fixtures/capture/ tiene su fragmento esperado de capture@1, por ruta. Chromium de Playwright lanzado por
// el test, sin puerto de depuración. Corre con `make e2e` (npm run test:kits), no con `make check`.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "@playwright/test";
import {
	assertFragment,
	capture,
	launchBrowser,
	openWithKit,
	type Site,
	serveFixtures,
} from "./browser.ts";

let site: Site;
let browser: Browser;
before(async () => {
	site = await serveFixtures();
	browser = await launchBrowser();
});
after(async () => {
	await browser?.close();
	await site?.close();
});

const open = (page: string) => openWithKit(browser, `${site.url}/${page}`);

describe("kit de captura: valores y fuentes", () => {
	it("colores con alfa, fuente, sombras, radios y degradado lineal", async () => {
		const page = await open("values.html");
		const { byPath } = await capture(page);
		assertFragment(byPath, {
			"div[0]": {
				t: "frame",
				tag: "div",
				x: 0,
				y: 0,
				w: 100,
				h: 50,
				bg: [10, 20, 30, 1],
				rad: [4, 8, 12, 16],
				shs: [{ c: [0, 0, 0, 0.25], x: 0, y: 2, b: 4, s: 1, inset: false }],
				font: {
					fam: "sans-serif",
					size: 14,
					weight: "700",
					ls: "1px",
					tt: "uppercase",
					color: [255, 0, 0, 0.5],
				},
			},
			"div[0]/#text[0]": { t: "text", txt: "Hola", lines: 1 },
			"div[1]": {
				bg: null,
				grad: {
					angle: 90,
					stops: [
						{ c: [255, 0, 0, 1], p: 0 },
						{ c: [0, 0, 255, 1], p: 1 },
					],
				},
			},
			"div[2]": {
				w: 24,
				h: 24,
				bg: [0, 255, 0, 0.5],
				bw: [2, 2, 2, 2],
				bc: [0, 0, 255, 1],
			},
		});
		await page.close();
	});
});

describe("kit de captura: cajas y visibilidad", () => {
	it("cajas respecto al padre; lo oculto, sr-only, fuera del lienzo y el contenido de un details cerrado no salen", async () => {
		const page = await open("boxes.html");
		const { byPath } = await capture(page);
		assertFragment(byPath, {
			"div[0]": { w: 320, h: 220, disp: "flex", gap: 5, pad: [10, 10, 10, 10] },
			"div[0]/div[0]": { x: 10, y: 10, w: 50, h: 30, bg: [255, 0, 0, 1] },
			// display:contents: la caja que abarca a sus hijos, con el hijo en 0,0
			"div[0]/div[1]": { x: 120, y: 10, w: 40, h: 20 },
			"div[0]/div[1]/p[0]": { x: 0, y: 0, w: 40, h: 20 },
			// absoluto que el navegador pinta encima
			"div[0]/div[2]": { x: 200, y: 100, pos: "absolute", top: true },
			"div[0]/div[3]": null,
			"div[0]/span[0]": null,
			"div[1]": null,
			"details[0]/summary[0]/#text[0]": { txt: "▸ " },
			"details[0]/summary[0]/#text[1]": { txt: "Más" },
			"details[0]/p[0]": null,
		});
		await page.close();
	});
});

describe("kit de captura: imágenes y svg", () => {
	it("img, svg en línea, triángulo de CSS, canvas y fondo con imagen", async () => {
		const page = await open("images.html");
		const { byPath } = await capture(page);
		assertFragment(byPath, {
			"img[0]": {
				t: "img",
				src: "dot.svg",
				w: 40,
				h: 20,
				data: /^data:image\/png;base64,/,
			},
			"svg[0]": {
				t: "svg",
				key: "M0 0L24 24",
				color: [0, 128, 0, 1],
				svg: /stroke="rgb\(0, 128, 0\)"/,
			},
			"div[0]": { t: "svg", color: [255, 0, 0, 1], svg: /<polygon/ },
			"canvas[0]": {
				t: "img",
				tag: "canvas",
				w: 10,
				h: 10,
				data: /^data:image\/png/,
			},
			"div[1]/bg[0]": {
				t: "img",
				x: 0,
				y: 0,
				w: 10,
				h: 10,
				data: /^data:image\/png/,
			},
		});
		assert.doesNotMatch(String(byPath.get("svg[0]")?.["svg"]), /currentColor/);
		await page.close();
	});
});

describe("kit de captura: controles de formulario", () => {
	it("valor, placeholder, contraseña, select, textarea, casillas, radio y fecha", async () => {
		const page = await open("controls.html");
		const { byPath } = await capture(page);
		assertFragment(byPath, {
			"input[0]/#text[0]": { txt: "abc", lines: 1 },
			"input[1]/#text[0]": { txt: "Escribe", font: { color: [1, 2, 3, 1] } },
			"input[2]/#text[0]": { txt: "••" },
			"select[0]/#text[0]": { txt: "Dos" },
			"textarea[0]": { va: "top" },
			"textarea[0]/#text[0]": { txt: "hola", lines: 2 },
			"checkbox[0]": { w: 16, h: 16, rad: [2.5, 2.5, 2.5, 2.5] },
			"checkbox[0]/svg[0]": { t: "svg", w: 16, h: 16 },
			"checkbox[1]": { bg: [255, 255, 255, 1], bw: [1, 1, 1, 1], kids: [] },
			"radio[0]/span[0]": { w: 12.8, h: 12.8 },
			"radio[0]/span[1]": {},
			"input[3]": { disp: "flex", jc: "space-between" },
			"input[3]/#text[0]": { txt: "11/11/2026" },
			"input[3]/icon[0]": { t: "icon", name: "calendar", w: 16, h: 16 },
		});
		await page.close();
	});
});

describe("kit de captura: pseudo y marcadores", () => {
	it("::before y ::after con texto, viñetas, números con start y cuadrados", async () => {
		const page = await open("pseudo.html");
		const { byPath } = await capture(page);
		assertFragment(byPath, {
			"p[0]/#text[0]": { txt: "«", lines: 1 },
			"p[0]/#text[1]": { txt: "Texto" },
			"p[0]/#text[2]": { txt: "»" },
			"ul[0]/li[0]/#text[0]": { txt: "•", pos: "absolute" },
			"ul[0]/li[0]/#text[1]": { txt: "uno" },
			"ul[0]/li[1]/#text[0]": { txt: "•" },
			"ol[0]/li[0]/#text[0]": { txt: "3." },
			"ul[1]/li[0]/#text[0]": { txt: "▪" },
		});
		await page.close();
	});
});

describe("kit de captura: espera, strip, ganchos y pick", () => {
	it("settle espera a la imagen lenta y quita las transiciones; strip y la barra de desplazamiento", async () => {
		const page = await open("wait.html");
		const { byPath } = await capture(page, {
			strip: [".quitar"],
			hideScrollbar: true,
		});
		assertFragment(byPath, {
			"div[0]/img[0]": { t: "img", w: 40, h: 20 },
			"div[0]/p[0]/#text[0]": { t: "text", txt: "fuera por ignore" },
		});
		assert.equal(
			[...byPath.values()].some((n) => n["txt"] === "fuera por strip"),
			false,
		);
		assert.equal(
			await page.evaluate(
				"getComputedStyle(document.getElementById('animado')).transitionDuration",
			),
			"0s",
		);
		assert.equal(
			await page.evaluate("document.documentElement.style.scrollbarWidth"),
			"none",
		);
		await page.close();
	});

	it("until llega cuando aparece el elemento y devuelve false si vence el plazo", async () => {
		const page = await open("wait.html");
		const reached = await page.evaluate(
			"window.__figmaCaptureKit.pieces.until(() => document.getElementById('tarde'), 3000)",
		);
		const never = await page.evaluate(
			"window.__figmaCaptureKit.pieces.until(() => document.getElementById('nunca'), 200)",
		);
		assert.deepEqual([reached, never], [true, false]);
		await page.close();
	});

	it("los ganchos ready e ignore se aplican y pick deja una sola raíz", async () => {
		const page = await open("wait.html");
		const hooks = `{ contract: "capture@1", hooks: {
			ready: (ctx) => { ctx.page.document.body.dataset.listo = ctx.screen.key; },
			ignore: (el) => el.classList.contains("ignorada"),
		} }`;
		const { byPath } = await capture(page, { hooks, pick: "#zona" });
		assert.deepEqual(
			[...byPath.keys()].filter((p) => !p.includes("/")),
			["div[0]"],
		);
		assert.equal(
			[...byPath.values()].some((n) => n["txt"] === "fuera por ignore"),
			false,
		);
		assert.equal(await page.evaluate("document.body.dataset.listo"), "ejemplo");
		await page.close();
	});

	it("un módulo de ganchos sin contrato o con un gancho desconocido se rechaza", async () => {
		const page = await open("wait.html");
		const problems = await page.evaluate(`[
			window.__figmaCaptureKit.useHooks({ hooks: {} }),
			window.__figmaCaptureKit.useHooks({ contract: "capture@1", hooks: { after: () => 1 } }),
			window.__figmaCaptureKit.useHooks({ contract: "capture@1", hooks: {} }),
		]`);
		assert.match(String((problems as unknown[])[0]), /capture@1/);
		assert.match(String((problems as unknown[])[1]), /after/);
		assert.equal((problems as unknown[])[2], null);
		await page.close();
	});
});
