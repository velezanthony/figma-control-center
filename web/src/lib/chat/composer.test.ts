import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { composerHeight, shouldSubmit } from "./composer.ts";

describe("composerHeight: el campo crece con el texto hasta un máximo de líneas", () => {
	const base = { lineHeight: 24, maxLines: 8, minLines: 1, padding: 16 };

	it("una línea de texto mide una línea más el relleno", () => {
		assert.equal(composerHeight({ ...base, scrollHeight: 40 }), 40);
	});

	it("crece con el contenido", () => {
		assert.equal(composerHeight({ ...base, scrollHeight: 88 }), 88);
	});

	it("no pasa del máximo: a partir de ahí hace scroll", () => {
		assert.equal(composerHeight({ ...base, scrollHeight: 900 }), 8 * 24 + 16);
	});

	it("nunca baja del mínimo", () => {
		assert.equal(composerHeight({ ...base, scrollHeight: 10 }), 1 * 24 + 16);
	});
});

describe("shouldSubmit: Intro envía, Mayús+Intro es salto de línea", () => {
	const key = (over: Partial<Parameters<typeof shouldSubmit>[0]>) =>
		shouldSubmit({
			key: "Enter",
			shiftKey: false,
			isComposing: false,
			...over,
		});

	it("Intro solo envía", () => assert.equal(key({}), true));
	it("Mayús+Intro no envía", () =>
		assert.equal(key({ shiftKey: true }), false));
	it("otra tecla no envía", () => assert.equal(key({ key: "a" }), false));
	it("Intro que confirma una composición (IME, acentos muertos) no envía", () => {
		assert.equal(key({ isComposing: true }), false);
	});
});
