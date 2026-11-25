import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STEP_STATUS } from "./build.ts";
import { JOB_KIND, JOB_STATUS, type Job, toJobId } from "./job.ts";

describe("Job: lote (kind build)", () => {
	it("un lote puede quedar cancelled con su progreso y sus pasos", () => {
		const job: Job = {
			id: toJobId("j1"),
			kind: JOB_KIND.build,
			status: JOB_STATUS.cancelled,
			outcome: {
				ok: true,
				result: null,
				error: null,
				touchedNodeIds: ["1:2"],
				retryable: false,
			},
			progress: { done: 1, total: 2, cancelled: 0, skipped: 0, current: null },
			steps: [
				{
					index: 0,
					file: "a.js",
					status: STEP_STATUS.done,
					ms: 5,
					touchedCount: 1,
					error: null,
					warning: null,
					result: null,
				},
			],
		};
		assert.equal(job.status, "cancelled");
		assert.equal(job.kind, JOB_KIND.build);
	});

	it("un job de script no lleva kind", () => {
		const job: Job = { id: toJobId("j2"), status: JOB_STATUS.running };
		assert.equal("kind" in job, false);
	});
});
