// Texto y fuentes del pintor. Trampa 6 (medida); 10, 11, 12 y 22 (sin verificar).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FONT,
	frame,
	MONO,
	paint,
	planMap,
	SANS,
	styles,
	text,
	world,
} from "../screen-support.ts";

type Seg = {
	characters: string;
	fontName: { family: string; style: string };
	fontSize: number;
};
const fontOf = (n: { fontName?: unknown } | undefined | null) =>
	(n?.fontName ?? { family: "", style: "" }) as {
		family: string;
		style: string;
	};
const wrap = (...kids: unknown[]) => frame({ disp: "flex" }, kids);

describe("pintor: texto", () => {
	it("trampa 6 (medida): las fuentes se cargan antes de escribir el texto; sin cargarlas, Figma lanza", async () => {
		const w = world();
		styles(w.fake);
		const t = w.fake.createText();
		assert.throws(() => {
			t.fontName = { family: SANS, style: "Regular" };
		}, /unloaded font/);
		const { root } = await paint(w, [wrap(text("Hola"))]);
		const out = root.children[0];
		assert.equal(out?.type, "TEXT");
		assert.equal(out?.characters, "Hola");
		assert.deepEqual(out?.fontName, { family: SANS, style: "Regular" });
	});

	it("un texto que ya cuadra con su estilo de texto lo conserva: no se reescribe lo que no difiere (trampa 10, sin verificar)", async () => {
		const w = world();
		const [regular] = [
			w.fake.textStyle(SANS, "Regular", 14, { lineHeight: 20 }),
		];
		const { root } = await paint(w, [wrap(text("Igual"))]);
		const out = root.children[0];
		assert.equal(out?.textStyleId, regular.id);
		assert.deepEqual(out?.lineHeight, { unit: "PIXELS", value: 20 });
	});

	it("si algo difiere (interlineado), se escribe y el estilo se desengancha; el caso real relee textStyleId (trampa 10)", async () => {
		const w = world();
		styles(w.fake);
		const { root } = await paint(w, [
			wrap(text("Distinto", { font: FONT({ lh: "22px" }) })),
		]);
		const out = root.children[0];
		assert.deepEqual(out?.lineHeight, { unit: "PIXELS", value: 22 });
		assert.equal(out?.textStyleId, "");
	});

	it("sin estilo de texto local para ese tamaño avisa TEXT_STYLE_MISSING y escribe lo que hay", async () => {
		const w = world();
		const t = w.kit.track();
		const { root } = await paint(w, [
			wrap(text("Sin estilo", { font: FONT({ size: 99 }) })),
		]);
		assert.equal(root.children[0]?.fontSize, 99);
		assert.ok(t.done().warnings?.some((x) => x.code === "TEXT_STYLE_MISSING"));
	});

	it("las familias salen de map@1: la que encaja con `match`, si no la de por defecto; las `strict` buscan su estilo exacto", async () => {
		const w = world();
		styles(w.fake);
		const mono = text("mono", {
			font: FONT({
				fam: "ui-monospace",
				size: 12,
				lh: "16px",
				ls: "0.5px",
				tt: "uppercase",
			}),
		});
		const { root } = await paint(w, [wrap(mono, text("sans"))]);
		const [a, b] = root.children;
		assert.equal(fontOf(a).family, MONO);
		assert.equal(fontOf(b).family, SANS);
		const style = w.fake.textStyles.find((s) => s.fontName.family === MONO);
		assert.equal(a?.textStyleId, style?.id);
		assert.equal(a?.textCase, "UPPER");
	});

	it("peso, cursiva, subrayado y tachado, color con variable y alineación", async () => {
		const w = world();
		styles(w.fake);
		const kids = [
			text("a", {
				font: FONT({
					weight: "600",
					td: "underline",
					ta: "center",
					color: [17, 24, 39, 1],
				}),
			}),
			text("b", {
				font: FONT({ fs: "italic", td: "line-through", ta: "end" }),
			}),
		];
		const { root } = await paint(w, [
			frame({ disp: "flex", cls: "text-text-primary" }, kids),
		]);
		const [a, b] = root.children;
		assert.equal(fontOf(a).style, "SemiBold");
		assert.equal(a?.textDecoration, "UNDERLINE");
		assert.equal(a?.textAlignHorizontal, "CENTER");
		const fills = a?.fills as { boundVariables?: { color?: { id: string } } }[];
		assert.equal(
			fills[0]?.boundVariables?.color?.id,
			w.variable("text/primary").id,
		);
		assert.equal(fontOf(b).style, "Italic");
		assert.equal(b?.textDecoration, "STRIKETHROUGH");
		assert.equal(b?.textAlignHorizontal, "RIGHT");
	});

	it("una línea crece a lo ancho; varias, a lo alto con el ancho del contenedor", async () => {
		const w = world();
		styles(w.fake);
		const long = text("una frase larga que ocupa varias líneas", {
			lines: 3,
			w: 120,
			h: 60,
		});
		const { root } = await paint(w, [wrap(text("corta"), long)]);
		const [one, many] = root.children;
		assert.equal(one?.textAutoResize, "WIDTH_AND_HEIGHT");
		assert.equal(many?.textAutoResize, "HEIGHT");
		assert.equal(many?.width, 121);
	});

	it("en una pantalla, el texto de una línea de un bloque sigue a su medida", async () => {
		const w = world();
		styles(w.fake);
		const help = frame({ tag: "div", w: 320, h: 16 }, [
			text("Máximo 200 caracteres.", { w: 141, h: 16 }),
		]);
		const { root } = await paint(w, [wrap(help)]);
		const out = root.findOne((n) => n.type === "TEXT");
		assert.equal(out?.textAutoResize, "WIDTH_AND_HEIGHT");
		assert.equal(out?.layoutGrow, 0);
	});

	it("truncate: una línea con puntos si el texto no cabe en el contenedor (trampa 22, sin verificar)", async () => {
		const w = world();
		styles(w.fake);
		const long = text("este texto es demasiado largo para su caja", { w: 300 });
		const { root } = await paint(w, [
			frame({ disp: "flex", cls: "truncate", w: 80 }, [long]),
		]);
		const out = root.children[0];
		assert.equal(out?.maxLines, 1);
		assert.equal(out?.textTruncation, "ENDING");
		assert.equal(out?.textAutoResize, "HEIGHT");
	});

	it("un párrafo con estilos mezclados es UN texto con tramos: cada uno con su letra, tamaño y decoración (trampa 12, sin verificar)", async () => {
		const w = world();
		styles(w.fake);
		const strong = frame(
			{
				tag: "strong",
				disp: "inline",
				font: FONT({ weight: "600", size: 16 }),
			},
			[text("fuerte", { font: FONT({ weight: "600", size: 16 }) })],
		);
		const paragraph = frame({ tag: "p", disp: "block", w: 300, h: 40 }, [
			text("Un ", { x: 0 }),
			strong,
			text(" párrafo", { x: 60 }),
		]);
		const { root } = await paint(w, [wrap(paragraph)]);
		const merged = root.children[0]?.children[0];
		assert.equal(merged?.name, "texto enriquecido");
		assert.equal(merged?.characters, "Un fuerte párrafo");
		const segments = merged?.getStyledTextSegments([
			"fontName",
			"fontSize",
		]) as Seg[];
		assert.deepEqual(
			segments.map((s) => [s.characters, s.fontName.style, s.fontSize]),
			[
				["Un ", "Regular", 14],
				["fuerte", "SemiBold", 16],
				[" párrafo", "Regular", 14],
			],
		);
		assert.equal(merged?.fontName, w.fake.mixed);
	});

	it("trampa 11 (sin verificar): tamaño, interlineado e interletraje en píxeles se leen con tolerancia", async () => {
		const w = world();
		styles(w.fake);
		const { root } = await paint(w, [
			wrap(
				text("x", { font: FONT({ size: 13.3, lh: "18.7px", ls: "0.3px" }) }),
			),
		]);
		const out = root.children[0];
		assert.ok(Math.abs((out?.fontSize ?? 0) - 13.3) < 0.01);
		assert.ok(
			Math.abs(Number((out?.lineHeight ?? {})["value" as never]) - 18.7) < 0.01,
		);
		assert.ok(
			Math.abs(Number((out?.letterSpacing ?? {})["value" as never]) - 0.3) <
				0.01,
		);
	});
});

describe("pintor: fuentes que faltan", () => {
	it("una fuente que falta da FONT_MISSING y el paso para sin haber creado ningún nodo", async () => {
		const w = world();
		const before = w.fake.all.size;
		const map = planMap({
			fonts: { ...(planMap()["fonts"] as object), default: "Ausente Sans" },
		});
		await assert.rejects(paint(w, [wrap(text("x"))], { map }), /FONT_MISSING/);
		assert.equal(w.fake.all.size, before);
	});

	it("con `fonts.fallback` se pinta con la familia de respaldo y se avisa FONT_FALLBACK", async () => {
		const w = world();
		w.fake.loadedFontsToLoad.add("Inter/Regular");
		const t = w.kit.track();
		const map = planMap({
			fonts: {
				...(planMap()["fonts"] as object),
				default: "Ausente Sans",
				fallback: "Inter",
				families: [],
			},
		});
		const { root } = await paint(w, [wrap(text("x"))], { map });
		assert.equal(fontOf(root.children[0]).family, "Inter");
		assert.ok(t.done().warnings?.some((x) => x.code === "FONT_FALLBACK"));
	});

	it("una cursiva que falta se pinta recta y se avisa; no para el paso", async () => {
		const w = world();
		styles(w.fake);
		w.fake.loadedFontsToLoad.delete(`${SANS}/Italic`);
		const t = w.kit.track();
		const { root } = await paint(w, [
			wrap(text("cursiva", { font: FONT({ fs: "italic" }) })),
		]);
		assert.equal(fontOf(root.children[0]).style, "Regular");
		assert.ok(t.done().warnings?.some((x) => x.code === "FONT_ITALIC_MISSING"));
	});
});

describe("kit.fonts.load (F4a)", () => {
	it("carga solo lo que falta; con `optional` devuelve las que no existen en vez de lanzar", async () => {
		const w = world();
		const missing = await w.kit.fonts.load(
			[
				{ family: SANS, style: "Regular" },
				{ family: "Ausente", style: "Regular" },
			],
			{ optional: true },
		);
		assert.deepEqual(missing, [{ family: "Ausente", style: "Regular" }]);
		await assert.rejects(
			w.kit.fonts.load([{ family: "Ausente", style: "Bold" }]),
			/FONT_MISSING/,
		);
	});
});

describe("fuentes: solo `{ family, style }` llega a Figma (medido en el archivo de pruebas)", () => {
	it("el doble rechaza una clave de más en loadFontAsync, fontName y setRangeFontName", async () => {
		const w = world();
		const bad = { family: SANS, style: "Regular", italic: true };
		await assert.rejects(
			w.fake.loadFontAsync(bad),
			/Unrecognized key: "italic"/,
		);
		const t = w.fake.createText();
		assert.throws(() => {
			t.fontName = bad;
		}, /Unrecognized key/);
	});

	it("el kit carga y pone la cursiva como estilo («Italic»), sin claves de más", async () => {
		const w = world();
		styles(w.fake);
		const { root } = await paint(w, [
			wrap(text("c", { font: FONT({ fs: "italic" }) })),
		]);
		assert.equal(fontOf(root.children[0]).style, "Italic");
		await assert.doesNotReject(
			w.kit.fonts.load([
				{ family: SANS, style: "Medium", italic: false } as never,
			]),
		);
	});
});
