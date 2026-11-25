import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, it } from "node:test";
import { isProcessAlive } from "./is-process-alive.ts";

describe("isProcessAlive", () => {
	it("el propio proceso está vivo", () => {
		assert.equal(isProcessAlive(process.pid), true);
	});

	it("un proceso que ya terminó no lo está", async () => {
		const child = spawn(process.execPath, ["-e", ""]);
		const pid = child.pid;
		await once(child, "exit");
		assert.ok(pid !== undefined);
		assert.equal(isProcessAlive(pid), false);
	});

	it("sin pid conocido cuenta como muerto", () => {
		assert.equal(isProcessAlive(null), false);
	});
});
