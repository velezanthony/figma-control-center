import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";
import { ERROR_SCENARIOS } from "./errors.ts";
import { SCENARIO_MARKER, SCENARIOS, SCRIPTS_DIR } from "./scenarios.ts";

describe("catálogo de escenarios", () => {
	it("cada tipo de error del dominio tiene al menos un escenario E1", () => {
		const covered = new Set(ERROR_SCENARIOS.map((s) => s.type));
		const missing = Object.values(FIGMA_ERROR_TYPE).filter((t) => !covered.has(t));
		assert.deepEqual(missing, [], `tipos de error sin escenario E1: ${missing.join(", ")}`);
	});

	it("ScriptError tiene sintaxis, ejecución y error dentro de la API de Figma", () => {
		const ids = ERROR_SCENARIOS.filter((s) => s.type === FIGMA_ERROR_TYPE.scriptError).map((s) => s.id);
		assert.deepEqual(ids.sort(), [
			"script-error-figma-internal",
			"script-error-runtime",
			"script-error-syntax",
		]);
	});

	it("los ids de escenario son únicos", () => {
		const ids = ERROR_SCENARIOS.map((s) => s.id);
		assert.equal(new Set(ids).size, ids.length);
	});

	it("cada escenario tiene su script con el marcador de su id, y no sobran scripts", () => {
		const files = readdirSync(SCRIPTS_DIR).sort();
		assert.deepEqual(
			files,
			Object.values(SCENARIOS).map((s) => s.script).sort(),
		);
		for (const scenario of Object.values(SCENARIOS)) {
			const text = readFileSync(join(SCRIPTS_DIR, scenario.script), "utf8");
			assert.equal(SCENARIO_MARKER.exec(text)?.[1], scenario.id, scenario.script);
		}
	});

	it("los escenarios de error con línea tienen su marcador en el script", () => {
		for (const e of ERROR_SCENARIOS) {
			if (e.setup.kind !== "script" || e.setup.lineMarker === undefined) continue;
			const text = readFileSync(join(SCRIPTS_DIR, SCENARIOS[e.setup.scenario].script), "utf8");
			assert.ok(text.includes(e.setup.lineMarker), `${e.id}: falta ${e.setup.lineMarker}`);
		}
	});
});
