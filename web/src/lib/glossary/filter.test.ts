import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { filterGlossary } from "./filter.ts";
import type { Term } from "./terms.ts";

const TERMS: readonly Term[] = [
	{
		key: "ok",
		label: "Correcto",
		short: "La llamada terminó bien.",
		group: "status",
	},
	{
		key: "ScriptError",
		label: "Error del script",
		short: "El script lanzó una excepción.",
		long: "Mira la línea que se señala.",
		group: "errors",
	},
	{
		key: "figma_status",
		label: "figma_status",
		short: "Diagnóstico de la conexión.",
		group: "tools",
	},
];

const keys = (result: ReturnType<typeof filterGlossary>) =>
	result.map((g) => [g.id, g.terms.map((t) => t.key)]);

describe("filtro del glosario", () => {
	it("sin búsqueda ni grupo enseña todos los grupos con términos, en el orden de GROUPS", () => {
		assert.deepEqual(keys(filterGlossary(TERMS, { query: "", group: null })), [
			["status", ["ok"]],
			["errors", ["ScriptError"]],
			["tools", ["figma_status"]],
		]);
	});

	it("busca en el término, el código y las dos explicaciones, sin mayúsculas ni acentos", () => {
		assert.deepEqual(
			keys(filterGlossary(TERMS, { query: "LINEA", group: null })),
			[["errors", ["ScriptError"]]],
		);
		assert.deepEqual(
			keys(filterGlossary(TERMS, { query: "scripterror", group: null })),
			[["errors", ["ScriptError"]]],
		);
		assert.deepEqual(
			keys(filterGlossary(TERMS, { query: "diagnostico", group: null })),
			[["tools", ["figma_status"]]],
		);
	});

	it("el grupo deja solo ese grupo, y se combina con la búsqueda", () => {
		assert.deepEqual(
			keys(filterGlossary(TERMS, { query: "", group: "tools" })),
			[["tools", ["figma_status"]]],
		);
		assert.deepEqual(
			keys(filterGlossary(TERMS, { query: "script", group: "tools" })),
			[],
		);
	});

	it("una búsqueda sin coincidencias no deja ningún grupo", () => {
		assert.deepEqual(filterGlossary(TERMS, { query: "zzz", group: null }), []);
	});
});
