import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	type ActivityEvent,
} from "#domain/activity.ts";
import { makeImportActivity } from "./import-activity.ts";
import {
	InMemoryActivityArchive,
	InMemoryHistoryMaintenance,
} from "./testing/in-memory-history-ports.ts";

const event = (callId: string): ActivityEvent => ({
	v: ACTIVITY_VERSION,
	at: "2026-01-01T00:00:00.000Z",
	sessionId: "s",
	type: ACTIVITY_TYPE.toolCalled,
	callId,
	tool: "figma_status",
	args: {},
});

function setup() {
	const archive = new InMemoryActivityArchive();
	const maintenance = new InMemoryHistoryMaintenance();
	const run = makeImportActivity({
		archive,
		maintenance,
		key: "activity.jsonl",
	});
	return { archive, maintenance, run };
}

describe("makeImportActivity", () => {
	it("vuelca todo el archivo viejo en el histórico, en orden, bajo su clave", async () => {
		const { archive, maintenance, run } = setup();
		archive.events = [event("a"), event("b")];
		assert.deepEqual(await run(), { status: "imported", events: 2 });
		assert.equal(maintenance.imports.length, 1);
		assert.equal(maintenance.imports[0]?.key, "activity.jsonl");
		assert.deepEqual(maintenance.imports[0]?.events, archive.events);
	});

	it("repetirlo no importa otra vez", async () => {
		const { archive, run } = setup();
		archive.events = [event("a")];
		await run();
		assert.deepEqual(await run(), { status: "already-imported" });
	});

	it("un archivo vacío o inexistente no marca nada: no hay nada que importar", async () => {
		const { maintenance, run } = setup();
		assert.deepEqual(await run(), { status: "nothing-to-import" });
		assert.equal(maintenance.imports.length, 0);
	});
});
