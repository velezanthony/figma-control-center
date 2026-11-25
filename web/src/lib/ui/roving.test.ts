import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { nextIndex } from "./roving.ts";

describe("nextIndex (foco itinerante)", () => {
	it("en vertical, abajo y arriba dan la vuelta", () => {
		assert.equal(nextIndex("ArrowDown", 0, 3, "vertical"), 1);
		assert.equal(nextIndex("ArrowDown", 2, 3, "vertical"), 0);
		assert.equal(nextIndex("ArrowUp", 0, 3, "vertical"), 2);
		assert.equal(nextIndex("ArrowUp", 2, 3, "vertical"), 1);
	});

	it("en horizontal, derecha e izquierda; las verticales no cuentan", () => {
		assert.equal(nextIndex("ArrowRight", 0, 3, "horizontal"), 1);
		assert.equal(nextIndex("ArrowLeft", 0, 3, "horizontal"), 2);
		assert.equal(nextIndex("ArrowDown", 0, 3, "horizontal"), null);
		assert.equal(nextIndex("ArrowRight", 0, 3, "vertical"), null);
	});

	it("Inicio y Fin saltan a los extremos", () => {
		assert.equal(nextIndex("Home", 2, 5, "vertical"), 0);
		assert.equal(nextIndex("End", 0, 5, "horizontal"), 4);
	});

	it("otras teclas o una lista vacía no mueven nada", () => {
		assert.equal(nextIndex("a", 0, 3, "vertical"), null);
		assert.equal(nextIndex("ArrowDown", 0, 0, "vertical"), null);
	});
});
