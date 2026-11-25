import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { variantPath } from "./screen-url.ts";

describe("variantPath: la url de una variante", () => {
	it("sin query, la url tal cual", () => {
		assert.equal(variantPath("/g/x/raw/", undefined), "/g/x/raw/");
		assert.equal(variantPath("/g/x/raw/", {}), "/g/x/raw/");
	});

	it("añade los pares en el orden escrito, sin ordenar", () => {
		assert.equal(variantPath("/g/", { b: "2", a: "1" }), "/g/?b=2&a=1");
	});

	it("codifica como urlencode de Python: espacio es +, y se escapan ! * ' ( ) pero no _ . - ~", () => {
		assert.equal(
			variantPath("/g/", { _slot: '<c-a x="1">Hola mundo</c-a>' }),
			"/g/?_slot=%3Cc-a+x%3D%221%22%3EHola+mundo%3C%2Fc-a%3E",
		);
		assert.equal(
			variantPath("/g/", { k: "a!b*c'd(e)f_g.h-i~j" }),
			"/g/?k=a%21b%2Ac%27d%28e%29f_g.h-i~j",
		);
		assert.equal(
			variantPath("/g/", { "icon-left": "ñ" }),
			"/g/?icon-left=%C3%B1",
		);
	});

	it("una url que ya trae query se une con &", () => {
		assert.equal(variantPath("/g/?a=1", { b: "2" }), "/g/?a=1&b=2");
	});

	it("una url que termina en ? o & no duplica el separador", () => {
		assert.equal(variantPath("/g/?", { b: "2" }), "/g/?b=2");
		assert.equal(variantPath("/g/?a=1&", { b: "2" }), "/g/?a=1&b=2");
	});

	it("un valor vacío se escribe como clave=", () => {
		assert.equal(variantPath("/g/", { disabled: "" }), "/g/?disabled=");
	});
});
