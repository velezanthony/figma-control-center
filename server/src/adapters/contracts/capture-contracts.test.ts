import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import {
	CAPTURE_CONTRACT,
	CaptureSchema,
	captureSchemaIssues,
} from "./capture.ts";
import { PROJECT_CONTRACT, ProjectSchema } from "./project.ts";
import { SCREENS_CONTRACT, ScreensSchema } from "./screens.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

describe("contratos de la captura de la web: JSON Schema publicado", () => {
	for (const [{ name, version }, schema] of [
		[PROJECT_CONTRACT, ProjectSchema],
		[SCREENS_CONTRACT, ScreensSchema],
		[CAPTURE_CONTRACT, CaptureSchema],
	] as const) {
		it(`schemas/${name}.v${version}.json es el que sale del esquema zod`, () => {
			const file = join(REPO_ROOT, "schemas", `${name}.v${version}.json`);
			assert.deepEqual(
				JSON.parse(readFileSync(file, "utf8")),
				z.toJSONSchema(schema),
				`schemas/${name}.v${version}.json no coincide: regenéralo con «npm run schemas»`,
			);
		});
	}
});

describe("problemas de esquema de una captura, con el nodo donde están", () => {
	const node = (extra: Record<string, unknown>) => ({
		t: "text",
		id: "aaaaaaaa",
		path: "main[0]/#text[0]",
		txt: "x",
		w: 1,
		h: 1,
		...extra,
	});
	const capture = (kid: unknown) => ({
		contract: "capture@1",
		screen: "inicio",
		title: "Inicio",
		source: {
			url: "http://127.0.0.1:1/",
			viewport: { w: 1, h: 1 },
			screenScale: 1,
			devicePixelRatio: 1,
			capturedAt: "2026-11-11T10:00:00.000+01:00",
			kit: "capture-kit@1",
			hooks: null,
		},
		variants: [
			{
				props: {},
				nodes: [
					{
						t: "frame",
						id: "bbbbbbbb",
						path: "main[0]",
						w: 1,
						h: 1,
						kids: [kid],
					},
				],
				annotations: [],
			},
		],
		images: {},
		warnings: [],
	});

	it("una captura que cumple no da problemas", () => {
		assert.deepEqual(captureSchemaIssues(capture(node({}))), []);
	});

	it("una clave de más en un nodo anidado da el problema con el id y la ruta de ESE nodo", () => {
		const issues = captureSchemaIssues(capture(node({ inventado: 1 })));
		assert.equal(issues.length, 1);
		assert.deepEqual(
			[issues[0]?.code, issues[0]?.nodeId, issues[0]?.path],
			["schema", "aaaaaaaa", "main[0]/#text[0]"],
		);
		assert.match(
			issues[0]?.message ?? "",
			/aaaaaaaa[\s\S]*main\[0\]\/#text\[0\][\s\S]*inventado/,
		);
	});

	it("un problema fuera de los nodos no lleva nodo", () => {
		const bad = { ...capture(node({})), screen: "" };
		const issues = captureSchemaIssues(bad);
		assert.equal(issues[0]?.nodeId, undefined);
		assert.match(issues[0]?.message ?? "", /screen/);
	});
});
