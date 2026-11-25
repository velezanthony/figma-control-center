import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttemptItem, ScriptLookup } from "#domain/attempt.ts";
import { createHistory } from "./history.ts";
import { makeHistoryDiff } from "./history-diff.ts";
import { InMemoryHistoryQuery } from "./testing/in-memory-history-query.ts";
import { InMemoryResultStore } from "./testing/in-memory-ports.ts";

const lines = (prefix: string, n: number) =>
	Array.from({ length: n }, (_, i) => `${prefix}${i}`).join("\n");

function setup(inlineLines = 200) {
	const query = new InMemoryHistoryQuery();
	const store = new InMemoryResultStore();
	const history = createHistory({ query, now: () => new Date(), maxRows: 50 });
	const contents = new Map<string, string>();
	query.storedScriptFor = (sel): ScriptLookup => {
		const content = sel.by === "sha256" ? contents.get(sel.sha256) : undefined;
		return content === undefined
			? { kind: "not_found" }
			: {
					kind: "found",
					script: {
						sha256: "x",
						kind: "js",
						bytes: content.length,
						stored: "full",
						content,
					},
				};
	};
	const attempt = (
		id: number,
		role: string,
		path: string,
		content: string,
	): void => {
		const sha = `${role}:${content}`;
		contents.set(sha, content);
		const item: AttemptItem = {
			id,
			n: id,
			kind: "run_script",
			target: "a.js",
			status: "ok",
			firstError: null,
			callId: null,
			jobId: null,
			stepIndex: null,
			startedAt: "2026-06-01T10:00:00.000Z",
			finishedAt: "2026-06-01T10:00:01.000Z",
			kit: "figma-kit@1",
			kitSha256: "k",
			assets: [],
			scripts: [
				{
					role: role as AttemptItem["scripts"][number]["role"],
					path,
					sha256: sha,
					bytes: content.length,
					stored: "full",
				},
			],
			changed: null,
			callKept: true,
		};
		query.attemptsById.set(id, item);
	};
	return {
		attempt,
		store,
		run: makeHistoryDiff({ history, store, inlineLines }),
	};
}

describe("makeHistoryDiff (figma_history_diff)", () => {
	it("un diff corto: el texto unificado en la respuesta y el entero en history-diffs/", async () => {
		const { attempt, store, run } = setup();
		attempt(1, "step", "", "a\nb\nc\n");
		attempt(2, "step", "", "a\nB\nc\n");
		const out = await run({ from: 1, to: 2 });
		assert.ok(out.ok);
		const diff = out.value.diff;
		assert.equal(diff?.kind, "diff");
		assert.equal(diff?.truncated, false);
		assert.match(diff?.text ?? "", /^@@ -1,3 \+1,3 @@$/m);
		assert.match(diff?.text ?? "", /^-b$/m);
		assert.match(diff?.text ?? "", /^\+B$/m);
		assert.equal(diff?.file, "/salida/history-diffs/1-2-step.diff");
		assert.match(store.diffs.get(diff?.file ?? "") ?? "", /^\+B$/m);
		assert.equal(out.value.roles[0]?.state, "changed");
	});

	it("un diff largo: recorta la respuesta a FCC_HISTORY_DIFF_INLINE_LINES y deja el entero en el fichero", async () => {
		const { attempt, store, run } = setup(20);
		attempt(1, "kit", "", lines("a", 100));
		attempt(2, "kit", "", lines("b", 100));
		const out = await run({ from: 1, to: 2 });
		assert.ok(out.ok);
		const diff = out.value.diff;
		assert.equal(diff?.truncated, true);
		assert.equal((diff?.text ?? "").split("\n").length - 1, 20);
		const whole = store.diffs.get(diff?.file ?? "") ?? "";
		assert.equal(
			whole.split("\n").filter((l) => l.startsWith("+b")).length,
			100,
		);
	});

	it("sin cambios: sin diff y sin fichero", async () => {
		const { attempt, store, run } = setup();
		attempt(1, "step", "", "a\n");
		attempt(2, "step", "", "a\n");
		const out = await run({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.equal(out.value.diff, null);
		assert.equal(store.diffs.size, 0);
	});

	it("el nombre del fichero lleva el papel y una ruta saneada (nada de «/» ni «..»)", async () => {
		const { attempt, store, run } = setup();
		attempt(1, "hooks", "../x/y.js", "a");
		attempt(2, "hooks", "../x/y.js", "b");
		const out = await run({ from: 1, to: 2, role: "hooks", path: "../x/y.js" });
		assert.ok(out.ok);
		const name = [...store.diffs.keys()][0] ?? "";
		assert.match(name, /\/history-diffs\/1-2-hooks-[A-Za-z0-9_-]+\.diff$/);
		assert.doesNotMatch(name.split("history-diffs/")[1] ?? "", /[/]|\.\./);
	});

	it("los errores de uso del caso de uso del diff pasan tal cual", async () => {
		const { attempt, run } = setup();
		attempt(1, "step", "", "a");
		const out = await run({ from: 1, to: 77 });
		assert.ok(!out.ok);
		assert.equal(out.error.type, "NotFound");
	});
});
