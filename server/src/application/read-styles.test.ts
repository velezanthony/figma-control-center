import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STYLE_KIND, type StyleEntry } from "#domain/catalog.ts";
import { ok } from "#domain/result.ts";
import { makeReadStyles } from "./read-styles.ts";
import { readSetup } from "./testing/read-setup.ts";

const PAINT: StyleEntry = {
	id: "S:a,",
	key: "a",
	name: "Marca/Primario",
	kind: STYLE_KIND.paint,
	description: "",
	boundVariables: {},
	value: [{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 } }],
};

describe("makeReadStyles (CA-3)", () => {
	it("deja los estilos en reads/ con su resumen por tipo", async () => {
		const { reader, store, deps } = readSetup();
		reader.stylesReply = async () => ok([PAINT]);
		const r = await makeReadStyles(deps)({});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(reader.stylesCalls, [null]);
		assert.equal(store.reads[0]?.name.tool, "styles");
		assert.deepEqual(JSON.parse(store.reads[0]?.json ?? ""), {
			styles: [PAINT],
		});
		assert.deepEqual(r.outcome.value.summary, {
			paint: 1,
			text: 0,
			effect: 0,
			grid: 0,
		});
	});

	it("con `kind` solo pide ese tipo", async () => {
		const { reader, deps } = readSetup();
		await makeReadStyles(deps)({ kind: STYLE_KIND.text });
		assert.deepEqual(reader.stylesCalls, [STYLE_KIND.text]);
	});
});
