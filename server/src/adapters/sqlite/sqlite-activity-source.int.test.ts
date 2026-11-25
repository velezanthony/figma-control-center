import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { StoredEvent } from "#application/ports/activity-source.ts";
import { ACTIVITY_TYPE } from "#domain/activity.ts";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import { SqliteActivitySource } from "./sqlite-activity-source.ts";
import { sessionStarted, toolCalled, toolFinished } from "./testing/events.ts";
import { openTestDb, PROJECT_ID } from "./testing/projects.ts";

const POLL_MS = 10;
const WAIT_MS = 3000;

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-source-"));
});
after(() => rm(dir, { recursive: true, force: true }));

function setup() {
	const file = join(dir, `s${++n}.db`);
	const log = new SqliteActivityLog({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		warn: () => {},
	});
	const source = new SqliteActivitySource({
		projectId: PROJECT_ID,
		db: openTestDb(file, { queryOnly: true }),
		pollMs: POLL_MS,
	});
	return { log, source };
}

const types = (events: readonly StoredEvent[]) =>
	events.map((s) => s.event.type);

describe("SqliteActivitySource (lo que lee el panel)", () => {
	it("latestId es 0 sin eventos y el id del último con ellos", () => {
		const { log, source } = setup();
		assert.equal(source.latestId(), 0);
		log.record(sessionStarted("s", 0));
		log.record(toolCalled("s", "c1", "figma_status", {}, 10));
		assert.equal(source.latestId(), 2);
	});

	it("readAfter devuelve lo registrado después de un id, en orden, con tope", () => {
		const { log, source } = setup();
		log.record(sessionStarted("s", 0));
		log.record(toolCalled("s", "c1", "figma_status", {}, 10));
		log.record(toolFinished("s", "c1", 20));
		assert.deepEqual(types(source.readAfter(0, 10)), [
			ACTIVITY_TYPE.sessionStarted,
			ACTIVITY_TYPE.toolCalled,
			ACTIVITY_TYPE.toolFinished,
		]);
		assert.deepEqual(
			source.readAfter(1, 10).map((s) => s.id),
			[2, 3],
		);
		assert.deepEqual(
			source.readAfter(1, 1).map((s) => s.id),
			[2],
		);
		assert.deepEqual(source.readAfter(3, 10), []);
	});

	it("follow entrega solo lo registrado después de empezar, sin repetir ninguno", async () => {
		const { log, source } = setup();
		log.record(sessionStarted("s", 0));
		const received: StoredEvent[] = [];
		const arrived = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`llegaron ${received.length} de 2`)),
				WAIT_MS,
			);
			const stop = source.follow((events) => {
				received.push(...events);
				if (received.length >= 2) {
					clearTimeout(timer);
					stop();
					resolve();
				}
			});
		});
		log.record(toolCalled("s", "c1", "figma_status", {}, 10));
		log.record(toolFinished("s", "c1", 20));
		await arrived;
		assert.deepEqual(
			received.map((s) => s.id),
			[2, 3],
		);
		assert.deepEqual(types(received), [
			ACTIVITY_TYPE.toolCalled,
			ACTIVITY_TYPE.toolFinished,
		]);
	});
});
