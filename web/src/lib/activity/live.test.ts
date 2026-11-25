import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { ActivityEvent } from "#web/lib/contract.ts";
import { createRefreshScheduler, freshCallId } from "./live.ts";

const base = { v: 1, at: "2026-01-01T00:00:00.000Z", sessionId: "s" } as const;

describe("freshCallId", () => {
	it("un tool_called trae una fila nueva: devuelve su callId", () => {
		const e: ActivityEvent = {
			...base,
			type: "tool_called",
			callId: "c1",
			tool: "figma_status",
			args: {},
		};
		assert.equal(freshCallId(e), "c1");
	});

	it("el resto de eventos solo cambian filas que ya existen", () => {
		const finished: ActivityEvent = {
			...base,
			type: "tool_finished",
			callId: "c1",
			ok: true,
			ms: 1,
			touchedNodeIds: [],
		};
		const started: ActivityEvent = {
			...base,
			type: "session_started",
			pid: 1,
			fileUrl: "u",
		};
		const job: ActivityEvent = {
			...base,
			type: "job_finished",
			jobId: "j",
			ok: true,
			ms: 1,
			touchedNodeIds: [],
		};
		for (const e of [finished, started, job])
			assert.equal(freshCallId(e), null, e.type);
	});
});

describe("createRefreshScheduler", () => {
	it("una ráfaga se junta en un solo refresco, tras calmarse", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		try {
			let fired = 0;
			const scheduler = createRefreshScheduler(() => fired++, 150, 1000);
			scheduler.request();
			vi.advanceTimersByTime(100);
			scheduler.request();
			vi.advanceTimersByTime(100);
			assert.equal(fired, 0);
			vi.advanceTimersByTime(60);
			assert.equal(fired, 1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("con eventos sin pausa refresca igualmente al llegar al tope de espera", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		try {
			let fired = 0;
			const scheduler = createRefreshScheduler(() => fired++, 150, 1000);
			for (let t = 0; t < 1000; t += 60) {
				scheduler.request();
				vi.advanceTimersByTime(60);
			}
			assert.ok(fired >= 1, "sigue sin refrescar tras un segundo de goteo");
			scheduler.cancel();
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancel() descarta el refresco pendiente", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		try {
			let fired = 0;
			const scheduler = createRefreshScheduler(() => fired++, 150, 1000);
			scheduler.request();
			scheduler.cancel();
			vi.advanceTimersByTime(500);
			assert.equal(fired, 0);
		} finally {
			vi.useRealTimers();
		}
	});
});
