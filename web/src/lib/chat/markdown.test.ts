import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	type Block,
	type Inline,
	parseMarkdown,
	safeHref,
} from "./markdown.ts";

const text = (t: string): Inline => ({ t: "text", text: t });
const para = (...children: Inline[]): Block => ({ t: "p", children });

describe("parseMarkdown: estructura", () => {
	it("un párrafo con negrita, cursiva y código en línea", () => {
		assert.deepEqual(parseMarkdown("Hola **fuerte**, *suave* y `x`."), [
			para(
				text("Hola "),
				{ t: "strong", children: [text("fuerte")] },
				text(", "),
				{ t: "em", children: [text("suave")] },
				text(" y "),
				{ t: "code", text: "x" },
				text("."),
			),
		]);
	});

	it("un título lleva su nivel", () => {
		assert.deepEqual(parseMarkdown("## Resumen"), [
			{ t: "heading", level: 2, children: [text("Resumen")] },
		]);
	});

	it("una lista con viñetas y otra numerada que empieza donde dice", () => {
		assert.deepEqual(parseMarkdown("- a\n- b"), [
			{
				t: "list",
				ordered: false,
				start: 1,
				items: [[para(text("a"))], [para(text("b"))]],
			},
		]);
		const [numbered] = parseMarkdown("3. a\n4. b");
		assert.equal(numbered?.t === "list" && numbered.start, 3);
		assert.equal(numbered?.t === "list" && numbered.ordered, true);
	});

	it("una lista anidada cuelga de su elemento", () => {
		const [list] = parseMarkdown("- a\n  - b");
		assert.equal(list?.t, "list");
		const first = list?.t === "list" ? list.items[0] : [];
		assert.deepEqual(
			first?.map((b) => b.t),
			["p", "list"],
		);
	});

	it("un bloque de código con vallas conserva el texto literal y el lenguaje", () => {
		assert.deepEqual(parseMarkdown("```ts\nconst a = 1 < 2;\n```"), [
			{ t: "fence", lang: "ts", text: "const a = 1 < 2;" },
		]);
	});

	it("una tabla trae cabecera, filas y alineación", () => {
		const [table] = parseMarkdown("| a | b |\n|---|:-:|\n| 1 | **2** |");
		assert.deepEqual(table, {
			t: "table",
			align: [null, "center"],
			head: [[text("a")], [text("b")]],
			rows: [[[text("1")], [{ t: "strong", children: [text("2")] }]]],
		});
	});

	it("una cita y una regla horizontal", () => {
		assert.deepEqual(parseMarkdown("> dicho\n\n---"), [
			{ t: "quote", children: [para(text("dicho"))] },
			{ t: "hr" },
		]);
	});

	it("un salto de línea dentro del párrafo se conserva", () => {
		const [p] = parseMarkdown("uno  \ndos");
		assert.deepEqual(p, para(text("uno"), { t: "br" }, text("dos")));
	});

	it("un texto vacío o solo espacios no produce bloques", () => {
		assert.deepEqual(parseMarkdown(""), []);
		assert.deepEqual(parseMarkdown("  \n\n "), []);
	});
});

describe("parseMarkdown: seguridad (las respuestas llevan texto de fuentes no fiables)", () => {
	it("el HTML en bruto es texto literal, no un elemento", () => {
		assert.deepEqual(parseMarkdown("<script>alert(1)</script>"), [
			para(text("<script>alert(1)</script>")),
		]);
		const [p] = parseMarkdown("hola <img src=x onerror=alert(1)> fin");
		assert.ok(p?.t === "p");
		assert.ok(p.children.every((c) => c.t === "text"));
		assert.match(JSON.stringify(p), /<img src=x onerror=alert\(1\)>/);
	});

	it("un enlace javascript:, data: o vbscript: pierde el enlace y conserva el texto", () => {
		for (const href of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			"data:text/html,x",
			"vbscript:x",
		]) {
			const [p] = parseMarkdown(`[clic](${href})`);
			assert.deepEqual(p, para({ t: "text", text: "clic" }), href);
		}
	});

	it("un enlace http, https o mailto se conserva", () => {
		const [p] = parseMarkdown("[doc](https://example.com/a?b=1)");
		assert.deepEqual(
			p,
			para({
				t: "link",
				href: "https://example.com/a?b=1",
				children: [text("doc")],
			}),
		);
	});

	it("una imagen nunca se carga: queda su texto alternativo", () => {
		assert.deepEqual(parseMarkdown("![logo](https://example.com/x.png)"), [
			para(text("logo")),
		]);
	});

	it("un enlace automático (URL suelta) se enlaza", () => {
		const [p] = parseMarkdown("mira https://example.com/a_b ahora");
		assert.ok(
			p?.t === "p" &&
				p.children.some(
					(c) => c.t === "link" && c.href === "https://example.com/a_b",
				),
		);
	});
});

describe("safeHref", () => {
	it("solo http, https y mailto; relativas y de protocolo implícito no", () => {
		assert.equal(safeHref("https://a.b/c"), "https://a.b/c");
		assert.equal(safeHref("http://a.b"), "http://a.b/");
		assert.equal(safeHref("mailto:a@b.c"), "mailto:a@b.c");
		for (const bad of [
			"javascript:1",
			"//evil.com",
			"/ruta",
			"#x",
			"file:///etc/passwd",
			"",
			"https://",
		]) {
			assert.equal(safeHref(bad), null, bad);
		}
	});
});

describe("parseMarkdown: ids de nodo y de llamada", () => {
	const CALL = "3f9d5c00-aaaa-4bbb-8ccc-0123456789ab";

	it("un id de nodo en el texto se convierte en referencia", () => {
		assert.deepEqual(parseMarkdown("Tocó 1234:5678."), [
			para(
				text("Tocó "),
				{ t: "node", id: "1234:5678", code: false },
				text("."),
			),
		]);
	});

	it("un id de llamada en código en línea es una referencia con aspecto de código", () => {
		assert.deepEqual(parseMarkdown(`\`${CALL}\``), [
			para({ t: "call", id: CALL, code: true }),
		]);
	});

	it("un id de nodo con pinta de hora en código en línea sí se enlaza; en prosa no", () => {
		assert.deepEqual(parseMarkdown("`1:23`"), [
			para({ t: "node", id: "1:23", code: true }),
		]);
		assert.deepEqual(parseMarkdown("a las 11:59"), [para(text("a las 11:59"))]);
	});

	it("los ids dentro de un bloque de código y dentro del texto de un enlace no se tocan", () => {
		assert.deepEqual(parseMarkdown("```\n1234:5678\n```"), [
			{ t: "fence", lang: "", text: "1234:5678" },
		]);
		const [p] = parseMarkdown("[ver 1234:5678](https://example.com)");
		assert.deepEqual(
			p,
			para({
				t: "link",
				href: "https://example.com/",
				children: [text("ver 1234:5678")],
			}),
		);
	});

	it("los ids se enlazan también en celdas de tabla y en elementos de lista", () => {
		const [list] = parseMarkdown("- nodo 1234:5678");
		assert.match(JSON.stringify(list), /"t":"node"/);
		const [table] = parseMarkdown("| id |\n|---|\n| 1234:5678 |");
		assert.match(JSON.stringify(table), /"t":"node"/);
	});
});
