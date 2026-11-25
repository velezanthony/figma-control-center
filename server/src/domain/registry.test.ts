import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAX_PROJECT_ID,
	projectIdProblem,
	toProjectNumber,
} from "./registry.ts";

describe("projectIdProblem", () => {
	it("un número de 1 a 32767 vale", () => {
		for (const id of ["1", "2", "42", "32767"]) {
			assert.equal(projectIdProblem(id), null, id);
		}
		assert.equal(MAX_PROJECT_ID, 32767);
	});

	it("fuera del tope, el cero y los ceros a la izquierda no valen", () => {
		for (const id of ["0", "32768", "100000", "01", "007"]) {
			assert.notEqual(projectIdProblem(id), null, id);
		}
	});

	it("un UUID, un nombre, un símbolo o un decimal no valen (el id solo lo da la base)", () => {
		for (const id of [
			"9bd5548d-835d-47bf-88c8-3e84fb4dd806",
			"default",
			"chat-tokens",
			"a1",
			"1a",
			"-1",
			"1.5",
			"1/2",
			"..",
			"",
			" 1",
		]) {
			assert.notEqual(projectIdProblem(id), null, JSON.stringify(id));
		}
	});
});

describe("toProjectNumber", () => {
	it("el id como número, que es lo que llevan las tablas del histórico", () => {
		assert.equal(toProjectNumber("1"), 1);
		assert.equal(toProjectNumber("32767"), 32767);
	});

	it("un id que no es de proyecto no se convierte: es un bug de quien lo pasa", () => {
		for (const id of ["abc", "0", "01", "32768", ""]) {
			assert.throws(() => toProjectNumber(id), /id de proyecto/, id);
		}
	});
});
