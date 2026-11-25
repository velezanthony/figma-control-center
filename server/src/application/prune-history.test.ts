import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makePruneHistory } from "./prune-history.ts";
import { InMemoryHistoryMaintenance } from "./testing/in-memory-history-ports.ts";

describe("makePruneHistory", () => {
	it("borra lo anterior a hoy menos los días de retención", () => {
		const maintenance = new InMemoryHistoryMaintenance();
		maintenance.pruneResult = {
			events: 10,
			calls: 4,
			sessions: 1,
			attempts: 2,
			scripts: 3,
		};
		const prune = makePruneHistory({
			maintenance,
			retentionDays: 90,
			now: () => new Date("2026-06-01T12:00:00.000Z"),
		});
		assert.deepEqual(prune(), {
			events: 10,
			calls: 4,
			sessions: 1,
			attempts: 2,
			scripts: 3,
		});
		assert.equal(
			maintenance.pruned[0]?.toISOString(),
			"2026-03-03T12:00:00.000Z",
		);
	});
});
