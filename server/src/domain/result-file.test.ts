import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isResultFileName } from "./result-file.ts";

describe("isResultFileName: solo un nombre, nunca una ruta", () => {
	it("acepta un nombre de fichero con letras, números, «_», «.» y «-»", () => {
		for (const name of ["figma_props.json", "a-b.c", "x", "resultado_2.JSON"]) {
			assert.equal(isResultFileName(name), true, name);
		}
	});

	it("rechaza «/», «..», un nombre vacío o solo de puntos y caracteres fuera de la regla", () => {
		for (const name of [
			"",
			".",
			"..",
			"...",
			"a/b",
			"../x",
			"a..b",
			"a b",
			"ñ.json",
			"a\\b",
		]) {
			assert.equal(isResultFileName(name), false, name);
		}
	});
});
