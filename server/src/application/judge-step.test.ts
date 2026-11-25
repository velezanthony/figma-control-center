import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { judgeStep } from "./judge-step.ts";
import { fakeStepIssues } from "./testing/fake-step-check.ts";

const HEADER = "// @contract step@1 · prueba\nreturn {};";

describe("judgeStep", () => {
	it("sin cabecera no juzga y ni mira el resultado", () => {
		let called = false;
		const judged = judgeStep("return {};", 7, () => {
			called = true;
			return [];
		});
		assert.deepEqual(judged, { kind: "unjudged" });
		assert.equal(called, false);
	});

	it("con cabecera y resultado bueno da los ids (creados, luego cambiados, sin repetir) y los avisos", () => {
		const judged = judgeStep(
			HEADER,
			{
				createdNodeIds: ["1:1", "1:2"],
				mutatedNodeIds: ["1:2", "1:3"],
				removedNodeIds: ["1:9"],
				warnings: [{ code: "A", message: "uno" }],
			},
			fakeStepIssues,
		);
		assert.deepEqual(judged, {
			kind: "ok",
			touched: ["1:1", "1:2", "1:3"],
			warning: "A: uno",
		});
	});

	it("con cabecera y resultado malo da el ContractError y los ids legibles", () => {
		const judged = judgeStep(
			HEADER,
			{ createdNodeIds: ["1:1", 4], mutatedNodeIds: ["1:2"] },
			fakeStepIssues,
		);
		assert.equal(judged.kind, "violated");
		if (judged.kind !== "violated") return;
		assert.equal(judged.error.type, "ContractError");
		assert.deepEqual(judged.touched, ["1:1", "1:2"]);
	});
});
