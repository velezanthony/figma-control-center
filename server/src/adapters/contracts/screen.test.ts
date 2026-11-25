import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import {
	SCREEN_CONTRACT_SOURCES,
	screenPlanExample,
} from "../../../test/contracts/screen.ts";
import { SCREEN_CONTRACT_NAME, ScreenPlanSchema } from "./screen.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON de prueba que se edita campo a campo
type Loose = any;
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const { name, version } = SCREEN_CONTRACT_NAME;
const example = () => structuredClone(screenPlanExample()) as Loose;
const valid = (v: unknown) => ScreenPlanSchema.safeParse(v).success;

describe("contrato screen@1", () => {
	it("el JSON Schema publicado es el que sale del esquema zod", () => {
		assert.deepEqual(
			JSON.parse(
				readFileSync(
					join(REPO_ROOT, "schemas", `${name}.v${version}.json`),
					"utf8",
				),
			),
			z.toJSONSchema(ScreenPlanSchema),
			`schemas/${name}.v${version}.json no coincide con ScreenPlanSchema: regenéralo con «npm run schemas»`,
		);
	});

	it("cita su fuente y el ejemplo cumple", () => {
		assert.ok(
			SCREEN_CONTRACT_SOURCES.some((s) =>
				s.includes("docs/users/contracts.md"),
			),
		);
		assert.equal(valid(example()), true);
	});

	it("una clave de más no cumple, ni en el plan ni en una imagen", () => {
		const a = example();
		a.inventada = 1;
		assert.equal(valid(a), false);
		const b = example();
		b.images["c".repeat(64)].extra = 1;
		assert.equal(valid(b), false);
	});

	it("el nodo de la raíz es el de capture@1: un nodo sin id no cumple", () => {
		const a = example();
		delete a.root[0].id;
		assert.equal(valid(a), false);
	});

	it("un aviso con un código que no existe no cumple", () => {
		const a = example();
		a.warnings[0].code = "OTRO";
		assert.equal(valid(a), false);
	});

	it("la clave de una imagen es un sha256 y `tooLarge` es booleano", () => {
		const a = example();
		a.images.corta = { asset: "x", width: 1, height: 1, type: "png" };
		assert.equal(valid(a), false);
		const b = example();
		b.images["c".repeat(64)].tooLarge = "sí";
		assert.equal(valid(b), false);
	});

	it("el plan no lleva la ruta del catálogo: sale resuelto en `icons`", () => {
		const a = example();
		a.map.icons.catalog = "icons.json";
		assert.equal(valid(a), false);
	});
});
