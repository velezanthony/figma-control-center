import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toJobId } from "#domain/job.ts";
import { makeGetStatus } from "./get-status.ts";
import { createJobRegistry } from "./job-registry.ts";
import {
	InMemoryFigmaGateway,
	READY_STATUS,
} from "./testing/in-memory-figma-gateway.ts";

describe("makeGetStatus", () => {
	it("devuelve el estado que informa el gateway, también cuando algo falla", async () => {
		const gateway = new InMemoryFigmaGateway();
		const down = {
			...READY_STATUS,
			chromeReachable: false,
			tabFound: false,
			figmaReady: false,
		};
		gateway.statusReply = down;
		const jobs = createJobRegistry(() => toJobId("job-1"));
		assert.deepEqual(await makeGetStatus(gateway, jobs)(), {
			...down,
			previousScriptRunning: false,
		});
	});

	it("dice que un script anterior sigue ejecutándose en la pestaña mientras el lock lo retiene", async () => {
		const gateway = new InMemoryFigmaGateway();
		const jobs = createJobRegistry(() => toJobId("job-1"));
		const id = jobs.startBuild([]);
		jobs.holdBuildLock(id, new Promise(() => {}));
		jobs.completeBuild(
			id,
			"cancelled",
			{
				ok: true,
				result: null,
				error: null,
				touchedNodeIds: [],
				retryable: false,
			},
			[],
		);
		assert.equal(
			(await makeGetStatus(gateway, jobs)()).previousScriptRunning,
			true,
		);
	});
});
