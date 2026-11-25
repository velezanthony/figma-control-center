import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	makeInterruptOwnJobs,
	makeSweepDeadSessionJobs,
} from "./interrupt-jobs.ts";
import { InMemoryHistoryMaintenance } from "./testing/in-memory-history-ports.ts";

const NOW = new Date("2026-11-09T10:00:00.000Z");

describe("jobs interrumpidos", () => {
	it("al apagar se cierran los jobs de esta sesión con un motivo que lo dice", () => {
		const maintenance = new InMemoryHistoryMaintenance();
		maintenance.interruptedCount = 2;
		const closed = makeInterruptOwnJobs({
			maintenance,
			sessionId: "yo",
			now: () => NOW,
		})();
		assert.equal(closed, 2);
		assert.deepEqual(
			maintenance.interruptedSessions.map((c) => [c.sessionId, c.at]),
			[["yo", NOW]],
		);
		assert.match(maintenance.interruptedSessions[0]?.reason ?? "", /se apagó/);
	});

	it("al arrancar se barren los de otras sesiones muertas, sin la propia", () => {
		const maintenance = new InMemoryHistoryMaintenance();
		makeSweepDeadSessionJobs({
			maintenance,
			sessionId: "yo",
			isAlive: () => true,
			now: () => NOW,
		})();
		assert.deepEqual(
			maintenance.sweeps.map((c) => c.ownSessionId),
			["yo"],
		);
		assert.match(maintenance.sweeps[0]?.reason ?? "", /sesión/);
	});

	it("ningún motivo afirma que el script no llegó a terminar: dicen que pudo seguir o acabar en Figma, que el servidor no puede saberlo y cómo comprobarlo", () => {
		const maintenance = new InMemoryHistoryMaintenance();
		makeInterruptOwnJobs({ maintenance, sessionId: "yo", now: () => NOW })();
		makeSweepDeadSessionJobs({
			maintenance,
			sessionId: "yo",
			isAlive: () => false,
			now: () => NOW,
		})();
		const reasons = [
			maintenance.interruptedSessions[0]?.reason ?? "",
			maintenance.sweeps[0]?.reason ?? "",
		];
		for (const reason of reasons) {
			assert.doesNotMatch(reason, /no llegó a terminar/);
			assert.match(reason, /pudo (haber )?seguir o terminar en Figma/);
			assert.match(reason, /no puede saberlo/);
			assert.match(reason, /figma_metadata/);
		}
	});
});
