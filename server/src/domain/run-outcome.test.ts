import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callTimeout, figmaNotReady, scriptError } from "./figma-error.ts";
import {
	extractTouchedNodeIds,
	failed,
	missingIdsWarning,
	NO_IDS_WARNING,
	succeeded,
} from "./run-outcome.ts";

describe("extractTouchedNodeIds", () => {
	it("une creados y mutados sin duplicados", () => {
		assert.deepEqual(
			extractTouchedNodeIds({
				createdNodeIds: ["1:1", "1:2"],
				mutatedNodeIds: ["1:2", "1:3"],
			}),
			["1:1", "1:2", "1:3"],
		);
	});

	it("devuelve vacío si el retorno no sigue la convención", () => {
		assert.deepEqual(extractTouchedNodeIds(undefined), []);
		assert.deepEqual(extractTouchedNodeIds("texto"), []);
		assert.deepEqual(extractTouchedNodeIds({ createdNodeIds: "1:1" }), []);
	});

	it("ignora elementos que no son cadenas", () => {
		assert.deepEqual(
			extractTouchedNodeIds({ mutatedNodeIds: ["1:1", 7, null] }),
			["1:1"],
		);
	});
});

describe("missingIdsWarning", () => {
	it("listas vacías declaradas son una declaración («no toqué nada»): sin aviso", () => {
		assert.equal(
			missingIdsWarning({ createdNodeIds: [], mutatedNodeIds: [] }),
			undefined,
		);
		assert.equal(
			missingIdsWarning({ mutatedNodeIds: [], pages: 3 }),
			undefined,
		);
	});

	it("con ids declarados no hay aviso", () => {
		assert.equal(missingIdsWarning({ createdNodeIds: ["1:1"] }), undefined);
	});

	it("sin ninguno de los dos campos como lista de textos, avisa", () => {
		assert.equal(missingIdsWarning({ movedCount: 3 }), NO_IDS_WARNING);
		assert.equal(missingIdsWarning(undefined), NO_IDS_WARNING);
		assert.equal(missingIdsWarning("hecho"), NO_IDS_WARNING);
		assert.equal(missingIdsWarning({ createdNodeIds: "1:1" }), NO_IDS_WARNING);
		assert.equal(missingIdsWarning({ createdNodeIds: [7] }), NO_IDS_WARNING);
	});
});

describe("RunOutcome", () => {
	it("succeeded no lleva error y no es reintentable", () => {
		const o = succeeded({ n: 1 }, ["1:1"]);
		assert.equal(o.ok, true);
		assert.equal(o.error, null);
		assert.deepEqual(o.touchedNodeIds, ["1:1"]);
	});

	it("failed hereda retryable del error", () => {
		assert.equal(failed(scriptError("x", 3, true)).retryable, false);
		assert.equal(failed(figmaNotReady(0)).retryable, true);
		assert.equal(failed(callTimeout(10)).retryable, false);
	});
});
