import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FrameInstances } from "#domain/catalog.ts";
import { ok } from "#domain/result.ts";
import { makeReadInstances } from "./read-instances.ts";
import { readSetup } from "./testing/read-setup.ts";

const FRAMES: FrameInstances[] = [
	{
		page: "Pantallas",
		frameId: "30:1",
		frameName: "Inicio",
		counts: { Botón: 3 },
	},
	{
		page: "Pantallas",
		frameId: "30:2",
		frameName: "Ajustes",
		counts: { Botón: 1, Icono: 2 },
	},
];

describe("makeReadInstances (CA-5)", () => {
	it("deja el conteo por frame en reads/ con frames e instancias en el resumen", async () => {
		const { reader, store, deps } = readSetup();
		reader.instancesReply = async () => ok(FRAMES);
		const r = await makeReadInstances(deps)({ pages: ["Pantallas"] });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(reader.instancesCalls, [
			{ pages: ["Pantallas"], frame: null },
		]);
		assert.equal(store.reads[0]?.name.tool, "instances");
		assert.deepEqual(JSON.parse(store.reads[0]?.json ?? ""), {
			frames: FRAMES,
		});
		assert.deepEqual(r.outcome.value.summary, { frames: 2, instances: 6 });
	});

	it("pasa las páginas y el frame al lector", async () => {
		const { reader, deps } = readSetup();
		await makeReadInstances(deps)({ pages: ["A", "B"], frame: "Inicio" });
		assert.deepEqual(reader.instancesCalls, [
			{ pages: ["A", "B"], frame: "Inicio" },
		]);
	});
});
