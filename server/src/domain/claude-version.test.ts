import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeVersionProblem, MIN_CLAUDE_VERSION } from "./claude-version.ts";

describe("claudeVersionProblem", () => {
	it("la mínima es la versión con la que se comprobaron las opciones del arnés", () => {
		assert.equal(MIN_CLAUDE_VERSION, "2.1.287");
	});

	it("la mínima o una posterior valen", () => {
		for (const out of [
			"2.1.287 (Claude Code)",
			"2.1.300 (Claude Code)\n",
			"2.2.0 (Claude Code)",
			"3.0.0",
		]) {
			assert.equal(claudeVersionProblem(out), null, out);
		}
	});

	it("una anterior se rechaza nombrando las dos versiones", () => {
		const problem = claudeVersionProblem("2.1.247 (Claude Code)");
		assert.match(problem ?? "", /2\.1\.247/);
		assert.match(problem ?? "", /2\.1\.287/);
		assert.notEqual(claudeVersionProblem("1.9.999"), null);
	});

	it("una salida sin versión se rechaza (no se arranca a ciegas)", () => {
		for (const out of ["", "claude: command not found", "v2"]) {
			assert.notEqual(claudeVersionProblem(out), null, out);
		}
	});
});
