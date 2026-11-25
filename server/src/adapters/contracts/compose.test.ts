import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import {
	COMPOSE_CONTRACT_NAME,
	ComposeSchema,
	composeSchemaIssues,
} from "./compose.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const { name, version } = COMPOSE_CONTRACT_NAME;

describe("compose@1: JSON Schema publicado", () => {
	it(`schemas/${name}.v${version}.json es el que sale del esquema zod`, () => {
		assert.deepEqual(
			JSON.parse(
				readFileSync(
					join(REPO_ROOT, "schemas", `${name}.v${version}.json`),
					"utf8",
				),
			),
			z.toJSONSchema(ComposeSchema),
			`schemas/${name}.v${version}.json no coincide: regenéralo con «npm run schemas»`,
		);
	});
});

describe("composeSchemaIssues", () => {
	const valid = {
		contract: "compose@1",
		key: "alta",
		title: "Alta",
		target: { page: "Pruebas", width: 640 },
		root: { text: "Hola", style: "Texto/S" },
	};

	it("un compose válido no da problemas", () => {
		assert.deepEqual(composeSchemaIssues(valid), []);
	});

	it("un fallo trae su puntero JSON y una clave de más lo dice", () => {
		assert.deepEqual(
			composeSchemaIssues({ ...valid, target: { page: "P", width: -1 } }).map(
				(i) => i.pointer,
			),
			["/target/width"],
		);
		const extra = composeSchemaIssues({
			...valid,
			root: { text: "x", style: "s", color: "c", ancho: 3 },
		});
		assert.ok(extra.some((i) => /ancho/.test(i.message)));
	});

	it("lo que no es un objeto es un fallo de la raíz", () => {
		assert.deepEqual(composeSchemaIssues([]), [
			{ pointer: "", message: "no es un objeto" },
		]);
	});
});
