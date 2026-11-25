import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHistory } from "./history.ts";
import { makeHistoryScript } from "./history-script.ts";
import { InMemoryHistoryQuery } from "./testing/in-memory-history-query.ts";
import { InMemoryResultStore } from "./testing/in-memory-ports.ts";

function setup() {
	const query = new InMemoryHistoryQuery();
	const store = new InMemoryResultStore();
	const run = makeHistoryScript({
		history: createHistory({ query, now: () => new Date(), maxRows: 50 }),
		store,
	});
	return { query, store, run };
}

const FOUND = {
	kind: "found",
	script: {
		sha256: "a".repeat(64),
		kind: "js",
		bytes: 10,
		stored: "full",
		content: "return 1;\n",
	},
} as const;

describe("makeHistoryScript (figma_history_script)", () => {
	it("escribe el contenido exacto en history-scripts/<sha256>.<ext> y devuelve ruta y bytes", async () => {
		const { query, store, run } = setup();
		query.storedScriptReply = FOUND;
		const out = await run({ attempt: 4, role: "step" });
		assert.ok(out.ok);
		assert.deepEqual(query.storedScriptCalls[0], {
			by: "attempt",
			attemptId: 4,
			role: "step",
			path: undefined,
		});
		assert.equal(out.value.sha256, "a".repeat(64));
		assert.equal(out.value.bytes, 10);
		assert.match(out.value.path, /history-scripts\/a{64}\.js$/);
		assert.equal(store.scripts.get(out.value.path), "return 1;\n");
	});

	it("un contenido JSON se guarda con extensión .json; por hash también vale", async () => {
		const { query, run } = setup();
		query.storedScriptReply = {
			kind: "found",
			script: { ...FOUND.script, kind: "json" },
		};
		const out = await run({ sha256: "a".repeat(64) });
		assert.ok(out.ok);
		assert.match(out.value.path, /\.json$/);
		assert.deepEqual(query.storedScriptCalls[0], {
			by: "sha256",
			sha256: "a".repeat(64),
		});
	});

	it("hay que dar attempt + role, o un sha256, y no los dos", async () => {
		const { run } = setup();
		for (const input of [
			{},
			{ attempt: 1 },
			{ role: "step" as const },
			{ attempt: 1, role: "step" as const, sha256: "x" },
		]) {
			const out = await run(input);
			assert.ok(!out.ok);
			assert.match(out.error.message, /attempt.*role|sha256/);
		}
	});

	it("un papel con varias rutas pide la ruta y las lista", async () => {
		const { query, run } = setup();
		query.storedScriptReply = { kind: "needs_path", paths: ["a.js", "b.js"] };
		const out = await run({ attempt: 1, role: "hooks" });
		assert.ok(!out.ok);
		assert.match(out.error.message, /path[\s\S]*a\.js[\s\S]*b\.js/);
	});

	it("un intento o un hash que no existen dan un error que lo dice", async () => {
		const { run } = setup();
		const out = await run({ attempt: 99, role: "step" });
		assert.ok(!out.ok);
		assert.equal(out.error.type, "NotFound");
	});

	it("un contenido too_big da un error de uso que lo dice y no escribe nada", async () => {
		const { query, store, run } = setup();
		query.storedScriptReply = {
			kind: "found",
			script: {
				...FOUND.script,
				stored: "too_big",
				content: null,
				bytes: 9_999_999,
			},
		};
		const out = await run({ attempt: 1, role: "step" });
		assert.ok(!out.ok);
		assert.match(out.error.message, /FCC_SCRIPT_MAX_BYTES[\s\S]*solo/);
		assert.equal(store.scripts.size, 0);
	});
});
