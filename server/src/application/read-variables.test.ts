import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VariablesRead } from "#domain/catalog.ts";
import { nodeNotFound } from "#domain/figma-error.ts";
import { err, ok } from "#domain/result.ts";
import { makeReadVariables } from "./read-variables.ts";
import { READ_AT, readSetup } from "./testing/read-setup.ts";

const READ: VariablesRead = {
	collections: [
		{
			id: "C:1",
			name: "Tokens",
			modes: [
				{ id: "1:0", name: "Claro" },
				{ id: "1:1", name: "Oscuro" },
			],
			defaultModeId: "1:0",
			variables: [
				{
					id: "V:1",
					name: "fondo",
					resolvedType: "COLOR",
					scopes: [],
					description: "",
					valuesByMode: {
						"1:0": { r: 1, g: 1, b: 1, a: 1 },
						"1:1": { alias: { id: "V:2", name: "gris/900" } },
					},
				},
			],
		},
	],
};

describe("makeReadVariables (CA-1, CA-2)", () => {
	it("deja todas las colecciones en reads/ y responde la ruta y un resumen pequeño", async () => {
		const { reader, store, deps } = readSetup();
		reader.variablesReply = async () => ok(READ);
		const r = await makeReadVariables(deps)({});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(reader.variablesCalls, [
			{ collection: null, nodeId: null },
		]);
		assert.equal(store.reads.length, 1);
		assert.deepEqual(store.reads[0]?.name, { tool: "variables", at: READ_AT });
		assert.deepEqual(JSON.parse(store.reads[0]?.json ?? ""), READ);
		assert.equal(r.outcome.value.path, "/salida/reads/variables-1.json");
		assert.deepEqual(r.outcome.value.summary, {
			collections: 1,
			variables: { Tokens: 1 },
			modes: { Tokens: 2 },
		});
	});

	it("pasa el nombre exacto de la colección y el nodo al lector", async () => {
		const { reader, deps } = readSetup();
		await makeReadVariables(deps)({ collection: "Tokens", nodeId: "10:1" });
		assert.deepEqual(reader.variablesCalls, [
			{ collection: "Tokens", nodeId: "10:1" },
		]);
	});

	it("un nodo que no existe es el error del lector y no se guarda nada", async () => {
		const { reader, store, deps } = readSetup();
		reader.variablesReply = async () => err(nodeNotFound("99:9"));
		const r = await makeReadVariables(deps)({ nodeId: "99:9" });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.match(r.outcome.error.message, /99:9/);
		assert.equal(store.reads.length, 0);
	});
});
