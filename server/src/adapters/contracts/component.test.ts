import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { COMPONENT_CONTRACT_NAME, ComponentPlanSchema } from "./component.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const { name, version } = COMPONENT_CONTRACT_NAME;

describe("component@1: JSON Schema publicado", () => {
	it(`schemas/${name}.v${version}.json es el que sale del esquema zod`, () => {
		assert.deepEqual(
			JSON.parse(
				readFileSync(
					join(REPO_ROOT, "schemas", `${name}.v${version}.json`),
					"utf8",
				),
			),
			z.toJSONSchema(ComponentPlanSchema),
			`schemas/${name}.v${version}.json no coincide: regenéralo con «npm run schemas»`,
		);
	});
});
