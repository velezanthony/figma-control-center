import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeMaintainHistory } from "./maintain-history.ts";

function setup(
	overrides: { importFails?: boolean; pruneFails?: boolean } = {},
) {
	const calls: string[] = [];
	const warnings: string[] = [];
	const maintain = makeMaintainHistory({
		importActivity: async () => {
			calls.push("import");
			if (overrides.importFails) throw new Error("disco lleno");
			return { status: "imported", events: 3 };
		},
		pruneHistory: () => {
			calls.push("prune");
			if (overrides.pruneFails) throw new Error("base bloqueada");
			return { events: 0, calls: 0, sessions: 0, attempts: 0, scripts: 0 };
		},
		warn: (m) => warnings.push(m),
	});
	return { maintain, calls, warnings };
}

describe("makeMaintainHistory (arranque del servidor y del panel)", () => {
	it("importa lo viejo y después aplica la retención", async () => {
		const { maintain, calls, warnings } = setup();
		await maintain();
		assert.deepEqual(calls, ["import", "prune"]);
		assert.deepEqual(warnings, []);
	});

	it("si la importación falla avisa y aun así aplica la retención", async () => {
		const { maintain, calls, warnings } = setup({ importFails: true });
		await maintain();
		assert.deepEqual(calls, ["import", "prune"]);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] ?? "", /disco lleno/);
	});

	it("si la retención falla avisa y no lanza: el mantenimiento nunca tumba el arranque", async () => {
		const { maintain, warnings } = setup({ pruneFails: true });
		await assert.doesNotReject(maintain());
		assert.match(warnings[0] ?? "", /base bloqueada/);
	});
});
