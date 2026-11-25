import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	type ActivityEvent,
} from "#domain/activity.ts";
import { JsonlActivityArchive, rotatedPath } from "./jsonl-activity-archive.ts";

let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-archive-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const event = (callId: string): ActivityEvent => ({
	v: ACTIVITY_VERSION,
	at: "2026-01-01T00:00:00.000Z",
	sessionId: "s1",
	type: ACTIVITY_TYPE.toolCalled,
	callId,
	tool: "figma_status",
	args: {},
});
const line = (callId: string) => `${JSON.stringify(event(callId))}\n`;
const ids = (events: readonly ActivityEvent[]) =>
	events.map((e) => (e.type === ACTIVITY_TYPE.toolCalled ? e.callId : "?"));

describe("rotatedPath", () => {
	it("activity.jsonl → activity.1.jsonl", () => {
		assert.equal(rotatedPath("/x/activity.jsonl"), "/x/activity.1.jsonl");
	});
});

describe("JsonlActivityArchive", () => {
	it("lee primero la generación rotada y luego la activa, sin perder ninguna línea válida", async () => {
		const file = join(dir, "dos.jsonl");
		await writeFile(rotatedPath(file), line("a") + line("b"));
		await writeFile(file, line("c"));
		assert.deepEqual(ids(await new JsonlActivityArchive({ file }).readAll()), [
			"a",
			"b",
			"c",
		]);
	});

	it("descarta líneas rotas o de otra forma y una última línea a medias", async () => {
		const file = join(dir, "sucio.jsonl");
		await writeFile(
			file,
			`${line("a")}esto no es json\n{"v":99,"type":"tool_called"}\n${line("b")}{"v":1,"at":"2026`,
		);
		assert.deepEqual(ids(await new JsonlActivityArchive({ file }).readAll()), [
			"a",
			"b",
		]);
	});

	it("si no existe ninguno de los dos archivos devuelve una lista vacía", async () => {
		const archive = new JsonlActivityArchive({
			file: join(dir, "no-existe.jsonl"),
		});
		assert.deepEqual(await archive.readAll(), []);
	});
});
