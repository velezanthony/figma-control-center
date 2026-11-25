import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deferred } from "./testing/in-memory-figma-gateway.ts";
import { withSoftDeadline } from "./with-soft-deadline.ts";

describe("withSoftDeadline", () => {
	it("un trabajo que acaba antes del plazo devuelve su valor", async () => {
		const r = await withSoftDeadline(Promise.resolve(42), 1000);
		assert.deepEqual(r, { kind: "finished", value: 42 });
	});

	it("un trabajo que no acaba dentro del plazo devuelve running", async () => {
		const slow = deferred<number>();
		const r = await withSoftDeadline(slow.promise, 5);
		assert.deepEqual(r, { kind: "running" });
	});
});
