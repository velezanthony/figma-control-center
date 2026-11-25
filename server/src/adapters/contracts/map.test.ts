import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import {
	MAP_CONTRACT_SOURCES,
	mapExample,
} from "../../../test/contracts/map.ts";
import { MAP_CONTRACT_NAME, MapSchema, mapSchemaIssues } from "./map.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON de prueba que se edita campo a campo
type Loose = any;

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const { name, version } = MAP_CONTRACT_NAME;
const example = () => structuredClone(mapExample()) as Loose;

describe("contrato map@1", () => {
	it("el JSON Schema publicado es el que sale del esquema zod", () => {
		assert.deepEqual(
			JSON.parse(
				readFileSync(
					join(REPO_ROOT, "schemas", `${name}.v${version}.json`),
					"utf8",
				),
			),
			z.toJSONSchema(MapSchema),
			`schemas/${name}.v${version}.json no coincide con MapSchema: regenéralo con «npm run schemas»`,
		);
	});

	it("cita su fuente", () => {
		assert.ok(
			MAP_CONTRACT_SOURCES.some((s) => s.includes("docs/users/contracts.md")),
		);
	});

	it("el ejemplo válido no da problemas", () => {
		assert.deepEqual(mapSchemaIssues(example()), []);
	});

	it("los problemas llevan el puntero JSON de lo que falla", () => {
		const bad = example();
		bad.layers.textPrefix = "sí";
		assert.deepEqual(
			mapSchemaIssues(bad).map((i) => i.pointer),
			["/layers/textPrefix"],
		);
	});

	it("una clave de más se nombra con el puntero del objeto", () => {
		const bad = example();
		bad.fonts.inventada = 1;
		const [issue] = mapSchemaIssues(bad);
		assert.equal(issue?.pointer, "/fonts");
		assert.match(issue?.message ?? "", /inventada/);
	});

	it("sin colecciones no vale: hay que decir dónde buscar variables", () => {
		const bad = example();
		bad.tokens.collections = [];
		assert.equal(mapSchemaIssues(bad)[0]?.pointer, "/tokens/collections");
	});

	it("un fichero que no es un objeto da un problema en la raíz", () => {
		assert.deepEqual(mapSchemaIssues([]), [
			{ pointer: "", message: "no es un objeto" },
		]);
	});

	it("fonts.fallback y los campos de F4b (components y screens) valen; una clave de más en ellos no", () => {
		const ok = example();
		ok.fonts.fallback = "Otra";
		ok.components = { fingerprints: "x.json", leaf: [], genericClasses: [] };
		ok.screens = { inicio: { rules: ["A"] } };
		assert.deepEqual(mapSchemaIssues(ok), []);
		const extra = example();
		extra.components = {
			fingerprints: "x.json",
			leaf: [],
			genericClasses: [],
			sobra: 1,
		};
		const [issue] = mapSchemaIssues(extra);
		assert.equal(issue?.pointer, "/components");
		assert.match(issue?.message ?? "", /sobra/);
	});
});
