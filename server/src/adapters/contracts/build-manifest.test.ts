import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import {
	BUILD_MANIFEST_CONTRACT,
	ManifestSchema,
	ManifestStepSchema,
} from "./build-manifest.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const { name, version } = BUILD_MANIFEST_CONTRACT;
const PUBLISHED = join(REPO_ROOT, "schemas", `${name}.v${version}.json`);

describe("contrato del manifiesto del lote", () => {
	it("el JSON Schema publicado es el que sale del esquema zod", () => {
		assert.deepEqual(
			JSON.parse(readFileSync(PUBLISHED, "utf8")),
			z.toJSONSchema(ManifestSchema),
			`schemas/${name}.v${version}.json no coincide con ManifestSchema: regenéralo con «npm run schemas» (o sube la versión si el cambio rompe)`,
		);
	});
});

describe("paso `use` del manifiesto", () => {
	const valid = (step: unknown) => ManifestStepSchema.safeParse(step).success;

	it("`{ use, area }` vale para cada paso del kit, con `timeoutMs` opcional", () => {
		for (const use of [
			"kit/place@1",
			"kit/share@1",
			"kit/links@1",
			"kit/fill-image@1",
			"kit/layout-check@1",
		]) {
			assert.equal(valid({ use, area: "Panel" }), true, use);
		}
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", timeoutMs: 5000 }),
			true,
		);
	});

	it("`use` con `file`, `use` con `params`, `use` sin área o un paso que no es del kit no valen", () => {
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", file: "a.js" }),
			false,
		);
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", params: { a: 1 } }),
			false,
		);
		assert.equal(valid({ use: "kit/place@1" }), false);
		assert.equal(valid({ use: "kit/layout-check@2", area: "Panel" }), false);
		assert.equal(valid({ use: "kit/layout-check@1" }), false);
		assert.equal(valid({ use: "kit/place@2", area: "Panel" }), false);
		assert.equal(valid({ area: "Panel" }), false);
	});

	it("un `file` de siempre sigue valiendo (CA-8)", () => {
		assert.equal(valid({ file: "a.js", params: { a: 1 }, assets: {} }), true);
	});

	it("se mezclan en un manifiesto", () => {
		assert.equal(
			ManifestSchema.safeParse({
				steps: [{ file: "a.js" }, { use: "kit/place@1", area: "Panel" }],
			}).success,
			true,
		);
	});
});

describe("paso `kit/build-screen@1` del manifiesto", () => {
	const valid = (step: unknown) => ManifestStepSchema.safeParse(step).success;

	it("`screen` es obligatorio aquí y `area`, `variant`, `capture` y `timeoutMs` son opcionales", () => {
		assert.equal(valid({ use: "kit/build-screen@1", screen: "home" }), true);
		assert.equal(
			valid({
				use: "kit/build-screen@1",
				screen: "home",
				area: "App",
				variant: 1,
				capture: "2026-11-12/home_101500.json",
				timeoutMs: 60000,
			}),
			true,
		);
		assert.equal(valid({ use: "kit/build-screen@1" }), false);
		assert.equal(valid({ use: "kit/build-screen@1", area: "App" }), false);
	});

	it("`screen`, `variant` y `capture` no valen en los otros pasos, que siguen pidiendo `area`", () => {
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", screen: "home" }),
			false,
		);
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", variant: 0 }),
			false,
		);
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", capture: "x" }),
			false,
		);
		assert.equal(valid({ use: "kit/place@1", screen: "home" }), false);
	});

	it("la variante es un entero que no baja de 0 y `file` o `params` no se mezclan", () => {
		assert.equal(
			valid({ use: "kit/build-screen@1", screen: "a", variant: -1 }),
			false,
		);
		assert.equal(
			valid({ use: "kit/build-screen@1", screen: "a", variant: 1.5 }),
			false,
		);
		assert.equal(
			valid({ use: "kit/build-screen@1", screen: "a", file: "a.js" }),
			false,
		);
		assert.equal(
			valid({ use: "kit/build-screen@1", screen: "a", params: {} }),
			false,
		);
	});
});

describe("paso `kit/build-component@1` del manifiesto", () => {
	const valid = (step: unknown) => ManifestStepSchema.safeParse(step).success;

	it("`sheet` es obligatorio y `scratch` y `timeoutMs` son opcionales", () => {
		assert.equal(
			valid({ use: "kit/build-component@1", sheet: "button" }),
			true,
		);
		assert.equal(
			valid({
				use: "kit/build-component@1",
				sheet: "button",
				scratch: true,
				timeoutMs: 120000,
			}),
			true,
		);
		assert.equal(valid({ use: "kit/build-component@1" }), false);
		assert.equal(valid({ use: "kit/build-component@1", sheet: "" }), false);
	});

	it("`file`, `params`, `area`, `screen` o un `scratch` que no es booleano no valen", () => {
		for (const extra of [
			{ file: "a.js" },
			{ params: {} },
			{ area: "Panel" },
			{ screen: "a" },
			{ scratch: "sí" },
		]) {
			assert.equal(
				valid({ use: "kit/build-component@1", sheet: "button", ...extra }),
				false,
				JSON.stringify(extra),
			);
		}
	});

	it("`sheet` y `scratch` no valen en los otros pasos", () => {
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", sheet: "b" }),
			false,
		);
		assert.equal(
			valid({ use: "kit/build-screen@1", screen: "a", scratch: true }),
			false,
		);
	});
});

describe("paso `kit/compose@1` del manifiesto", () => {
	const valid = (step: unknown) => ManifestStepSchema.safeParse(step).success;

	it("`compose` es obligatorio y `timeoutMs` opcional", () => {
		assert.equal(valid({ use: "kit/compose@1", compose: "alta" }), true);
		assert.equal(
			valid({ use: "kit/compose@1", compose: "alta", timeoutMs: 120000 }),
			true,
		);
		assert.equal(valid({ use: "kit/compose@1" }), false);
		assert.equal(valid({ use: "kit/compose@1", compose: "" }), false);
	});

	it("`file`, `params`, `area`, `screen`, `sheet` o `scratch` no valen", () => {
		for (const extra of [
			{ file: "a.js" },
			{ params: {} },
			{ area: "Panel" },
			{ screen: "a" },
			{ sheet: "b" },
			{ scratch: true },
		]) {
			assert.equal(
				valid({ use: "kit/compose@1", compose: "alta", ...extra }),
				false,
				JSON.stringify(extra),
			);
		}
	});

	it("`compose` no vale en los otros pasos", () => {
		assert.equal(
			valid({ use: "kit/place@1", area: "Panel", compose: "alta" }),
			false,
		);
		assert.equal(
			valid({ use: "kit/build-screen@1", screen: "a", compose: "alta" }),
			false,
		);
	});
});
