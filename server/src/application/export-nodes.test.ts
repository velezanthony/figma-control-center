import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPORT_FORMAT } from "#domain/catalog.ts";
import { nodeNotFound } from "#domain/figma-error.ts";
import { err, ok } from "#domain/result.ts";
import { makeExportNodes } from "./export-nodes.ts";
import { READ_AT, readSetup } from "./testing/read-setup.ts";

const setup = (maxNodes = 3) => {
	const s = readSetup();
	return { ...s, run: makeExportNodes({ ...s.deps, maxNodes }) };
};

describe("makeExportNodes (CA-6)", () => {
	it("guarda un fichero por nodo en exports/ y el índice en reads/", async () => {
		const { reader, store, run } = setup();
		reader.exportReply = async () =>
			ok([
				{ nodeId: "10:1", bytes: new Uint8Array(4), width: 120, height: 80 },
				{ nodeId: "10:3", bytes: new Uint8Array(2), width: 64, height: 32 },
			]);
		const r = await run({
			nodeIds: ["10:1", "10:3"],
			format: EXPORT_FORMAT.png,
			scale: 2,
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(reader.exportCalls, [
			{ nodeIds: ["10:1", "10:3"], format: "PNG", scale: 2 },
		]);
		assert.deepEqual(
			store.exports.map((e) => e.name),
			[
				{ nodeId: "10:1", format: "PNG", at: READ_AT },
				{ nodeId: "10:3", format: "PNG", at: READ_AT },
			],
		);
		assert.equal(store.reads[0]?.name.tool, "export");
		assert.deepEqual(JSON.parse(store.reads[0]?.json ?? ""), [
			{
				nodeId: "10:1",
				path: "/salida/exports/10-1.png",
				bytes: 4,
				width: 120,
				height: 80,
			},
			{
				nodeId: "10:3",
				path: "/salida/exports/10-3.png",
				bytes: 2,
				width: 64,
				height: 32,
			},
		]);
		assert.deepEqual(r.outcome.value.summary, { files: 2, bytes: 6 });
	});

	it("sin dimensiones (SVG, PDF) el índice no las inventa", async () => {
		const { reader, store, run } = setup();
		reader.exportReply = async () =>
			ok([{ nodeId: "10:1", bytes: new Uint8Array(3) }]);
		await run({ nodeIds: ["10:1"], format: EXPORT_FORMAT.svg, scale: 1 });
		assert.deepEqual(JSON.parse(store.reads[0]?.json ?? ""), [
			{ nodeId: "10:1", path: "/salida/exports/10-1.svg", bytes: 3 },
		]);
	});

	it("más nodos que el tope es un error de uso que no toca Figma ni crea job", async () => {
		const { reader, jobs, run } = setup(2);
		const r = await run({
			nodeIds: ["1:1", "1:2", "1:3"],
			format: EXPORT_FORMAT.png,
			scale: 1,
		});
		assert.equal(r.kind, "usage");
		assert.ok(r.kind === "usage");
		assert.match(r.message, /2/);
		assert.match(r.message, /FIGMA_EXPORT_MAX_NODES/);
		assert.equal(reader.readyCalls, 0);
		assert.equal(reader.exportCalls.length, 0);
		assert.equal(jobs.get("job-1" as never), undefined);
	});

	it("un id que no existe es el error del lector con el id y no se guarda nada", async () => {
		const { reader, store, run } = setup();
		reader.exportReply = async () => err(nodeNotFound("99:9"));
		const r = await run({
			nodeIds: ["99:9"],
			format: EXPORT_FORMAT.png,
			scale: 1,
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.match(r.outcome.error.message, /99:9/);
		assert.equal(store.exports.length, 0);
		assert.equal(store.reads.length, 0);
	});
});
