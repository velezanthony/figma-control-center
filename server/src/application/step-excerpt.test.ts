import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excerptOf } from "./step-excerpt.ts";

describe("excerptOf", () => {
	it("un resultado que cabe sale entero, en JSON compacto, sin recorte", () => {
		assert.deepEqual(excerptOf({ log: ["a", "b"] }, 300), {
			kind: "inline",
			excerpt: '{"log":["a","b"]}',
			bytes: 17,
			truncated: false,
		});
	});

	it("uno que no cabe se corta al tope y dice cuánto ocupa entero", () => {
		const value = { texto: "x".repeat(1000) };
		const total = JSON.stringify(value);
		const out = excerptOf(value, 300);
		assert.equal(out.excerpt, total.slice(0, 300));
		assert.equal(out.bytes, total.length);
		assert.equal(out.truncated, true);
	});

	it("el tope son bytes, no caracteres, y no parte un carácter de varios bytes", () => {
		// «ñ» ocupa 2 bytes: con tope impar el corte caería a medias y retrocede un byte
		const out = excerptOf("ñññññ", 4);
		assert.equal(out.excerpt, '"ñ');
		assert.equal(out.truncated, true);
		assert.equal(out.bytes, new TextEncoder().encode('"ñññññ"').byteLength);
		const emoji = excerptOf("😀😀", 4);
		assert.equal(emoji.excerpt, '"');
		assert.ok(!emoji.excerpt.includes("�"));
	});

	it("un valor justo en el tope no cuenta como recortado", () => {
		const out = excerptOf("abc", 5);
		assert.equal(out.excerpt, '"abc"');
		assert.equal(out.truncated, false);
	});

	it("un valor primitivo o null sale como JSON", () => {
		assert.equal(excerptOf(null, 300).excerpt, "null");
		assert.equal(excerptOf(42, 300).excerpt, "42");
	});
});
