import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPONENT_TYPE, type ComponentEntry } from "#domain/catalog.ts";
import { scriptError } from "#domain/figma-error.ts";
import { err, ok } from "#domain/result.ts";
import { makeReadComponents } from "./read-components.ts";
import { readSetup } from "./testing/read-setup.ts";

const SET: ComponentEntry = {
	id: "20:1",
	key: "k",
	name: "Botón",
	type: COMPONENT_TYPE.set,
	page: "Componentes",
	pageIndex: 1,
	description: "Acción principal",
	variants: { Tamaño: ["S", "M"] },
	properties: [{ name: "Texto#1:0", type: "TEXT", defaultValue: "Hola" }],
	variantCount: 2,
};

describe("makeReadComponents (CA-4)", () => {
	it("deja el catálogo en reads/ con sets, sueltos y páginas en el resumen", async () => {
		const { reader, store, deps } = readSetup();
		reader.componentsReply = async () => ok([SET]);
		const r = await makeReadComponents(deps)({});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(store.reads[0]?.name.tool, "components");
		assert.deepEqual(JSON.parse(store.reads[0]?.json ?? ""), {
			components: [SET],
		});
		assert.deepEqual(r.outcome.value.summary, {
			sets: 1,
			components: 0,
			pages: 1,
		});
	});

	it("pasa `page` y `query` al lector", async () => {
		const { reader, deps } = readSetup();
		await makeReadComponents(deps)({ page: "Componentes", query: "bot" });
		assert.deepEqual(reader.componentsCalls, [
			{ page: "Componentes", query: "bot" },
		]);
	});

	it("una página que no existe es el error del lector con su nombre", async () => {
		const { reader, store, deps } = readSetup();
		reader.componentsReply = async () =>
			err(scriptError("La página «Nada» no existe", null, false));
		const r = await makeReadComponents(deps)({ page: "Nada" });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.match(r.outcome.error.message, /Nada/);
		assert.equal(store.reads.length, 0);
	});
});
