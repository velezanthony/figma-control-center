import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import {
	STEP_CONTRACT_FILE,
	StepResultSchema,
	stepResultIssues,
} from "./step.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

describe("step@1: JSON Schema publicado", () => {
	it("schemas/step.v1.json es el que sale del esquema zod", () => {
		const file = join(REPO_ROOT, "schemas", STEP_CONTRACT_FILE);
		assert.deepEqual(
			JSON.parse(readFileSync(file, "utf8")),
			z.toJSONSchema(StepResultSchema),
			`schemas/${STEP_CONTRACT_FILE} no coincide: regenéralo con «npm run schemas»`,
		);
	});
});

describe("problemas de un resultado de paso, con su puntero JSON", () => {
	it("un resultado que cumple no da problemas", () => {
		assert.deepEqual(
			stepResultIssues({ createdNodeIds: ["1:2"], mutatedNodeIds: [] }),
			[],
		);
	});

	it("un id que no es texto señala su posición", () => {
		assert.deepEqual(
			stepResultIssues({
				createdNodeIds: ["1:2", "1:3", 7],
				mutatedNodeIds: [],
			}),
			[{ pointer: "/createdNodeIds/2", message: "no es texto" }],
		);
	});

	it("una lista que falta señala la lista", () => {
		const issues = stepResultIssues({ createdNodeIds: [] });
		assert.equal(issues.length, 1);
		assert.equal(issues[0]?.pointer, "/mutatedNodeIds");
		assert.equal(issues[0]?.message, "falta");
	});

	it("una clave de más señala el objeto donde está", () => {
		const issues = stepResultIssues({
			createdNodeIds: [],
			mutatedNodeIds: [],
			inventado: 1,
		});
		assert.deepEqual(issues, [
			{ pointer: "", message: "clave no admitida: inventado" },
		]);
	});

	it("lo que no es un objeto se dice en la raíz", () => {
		assert.deepEqual(stepResultIssues("hola"), [
			{ pointer: "", message: "no es un objeto" },
		]);
		assert.deepEqual(stepResultIssues(null), [
			{ pointer: "", message: "no es un objeto" },
		]);
		assert.deepEqual(stepResultIssues(undefined), [
			{ pointer: "", message: "no es un objeto" },
		]);
	});

	it("un aviso mal formado señala su campo y una clave de más dice cuál", () => {
		const warn = stepResultIssues({
			createdNodeIds: [],
			mutatedNodeIds: [],
			warnings: [{ code: "A", message: 3 }],
		});
		assert.deepEqual(warn, [
			{ pointer: "/warnings/0/message", message: "no es texto" },
		]);
		const odd = stepResultIssues({
			createdNodeIds: [],
			mutatedNodeIds: [],
			warnings: [{ code: "A", message: "m", "a/b~c": 1 }],
		});
		assert.equal(odd[0]?.pointer, "/warnings/0");
		assert.match(odd[0]?.message ?? "", /a\/b~c/);
	});
});
