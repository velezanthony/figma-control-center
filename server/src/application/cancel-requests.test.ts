import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CancelRequestInfo } from "#domain/cancel-request.ts";
import type { CancelJobResult } from "./cancel-job.ts";
import { makeHandleCancelRequests } from "./cancel-requests.ts";
import type { CancelInbox } from "./ports/cancel-requests.ts";

function setup(requests: readonly CancelRequestInfo[]) {
	const handled: number[] = [];
	const cancelled: string[] = [];
	const warnings: string[] = [];
	const inbox: CancelInbox = {
		pending: (sessionId) => requests.filter((r) => r.sessionId === sessionId),
		markHandled: (_s, id) => void handled.push(id),
	};
	const cancelJob = async (input: {
		readonly jobId: string;
	}): Promise<CancelJobResult> => {
		cancelled.push(input.jobId);
		if (input.jobId === "roto") throw new Error("boom");
		return { kind: "usage", message: "x" };
	};
	const handle = makeHandleCancelRequests({
		inbox,
		sessionId: "s1",
		cancelJob: (i) => cancelJob({ jobId: i.jobId }),
		warn: (m) => warnings.push(m),
	});
	return { handle, handled, cancelled, warnings };
}

const req = (id: number, jobId: string, sessionId = "s1") => ({
	id,
	jobId,
	sessionId,
});

describe("makeHandleCancelRequests", () => {
	it("ejecuta el caso de uso de cancelar por cada petición de su sesión y las marca recogidas", async () => {
		const { handle, handled, cancelled } = setup([
			req(1, "job-1"),
			req(2, "job-2", "otra"),
			req(3, "job-3"),
		]);
		assert.equal(await handle(), 2);
		assert.deepEqual(cancelled, ["job-1", "job-3"]);
		assert.deepEqual(handled, [1, 3]);
	});

	it("si cancelar lanza, se avisa y esa petición queda pendiente para el siguiente sondeo", async () => {
		const { handle, handled, warnings } = setup([
			req(1, "roto"),
			req(2, "job-2"),
		]);
		assert.equal(await handle(), 1);
		assert.deepEqual(handled, [2]);
		assert.match(warnings.join(" "), /roto/);
	});

	it("sin peticiones no hace nada", async () => {
		const { handle, cancelled } = setup([]);
		assert.equal(await handle(), 0);
		assert.deepEqual(cancelled, []);
	});
});
