import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { areasExample } from "../../../test/contracts/areas.ts";
import {
	AREAS_CONTRACT_NAME,
	AreasSchema,
	areasSchemaIssues,
} from "./areas.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON de prueba que se edita campo a campo
type Loose = any;

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const { name, version } = AREAS_CONTRACT_NAME;

const example = () => structuredClone(areasExample()) as Loose;

describe("contrato areas@1", () => {
	it("el JSON Schema publicado es el que sale del esquema zod", () => {
		assert.deepEqual(
			JSON.parse(
				readFileSync(
					join(REPO_ROOT, "schemas", `${name}.v${version}.json`),
					"utf8",
				),
			),
			z.toJSONSchema(AreasSchema),
			`schemas/${name}.v${version}.json no coincide con AreasSchema: regenéralo con «npm run schemas»`,
		);
	});

	it("los problemas llevan el puntero JSON de lo que falla", () => {
		const bad = example();
		bad["areas"][0].place.mode = "graft";
		assert.deepEqual(
			areasSchemaIssues(bad).map((i) => i.pointer),
			["/areas/0/place/mode"],
		);
	});

	it("una clave de más se nombra con el puntero del objeto", () => {
		const bad = example();
		bad["areas"][0].inventado = 1;
		const [issue] = areasSchemaIssues(bad);
		assert.equal(issue?.pointer, "/areas/0");
		assert.match(issue?.message ?? "", /inventado/);
	});

	it("un enlace malo apunta al enlace, no a «ninguna rama cumple»", () => {
		const bad = example();
		bad["areas"][0].links[0] = { from: "inicio", to: "detalle" };
		const [issue] = areasSchemaIssues(bad);
		assert.match(issue?.pointer ?? "", /^\/areas\/0\/links\/0/);
	});

	it("un fichero que no es un objeto da un problema en la raíz", () => {
		assert.deepEqual(areasSchemaIssues([]), [
			{ pointer: "", message: "no es un objeto" },
		]);
	});
});
