import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CallItem, StoredBuildStep } from "#domain/history.ts";
import { makeLastScreenMatches } from "./last-screen-matches.ts";
import { InMemoryHistoryQuery } from "./testing/in-memory-history-query.ts";

const call = (jobId: string | null) => ({ jobId }) as unknown as CallItem;
const step = (
	file: string,
	over: Partial<StoredBuildStep> = {},
): StoredBuildStep => ({
	index: 0,
	file,
	status: "done",
	ms: 1,
	touchedCount: 0,
	error: null,
	warning: null,
	result: {
		kind: "inline",
		value: {
			createdNodeIds: [],
			mutatedNodeIds: [],
			report: {
				matches: [
					{ node: "1:1", set: "Boton", by: "rule:boton" },
					{ node: "1:2", set: "Icono", by: "fingerprint" },
				],
			},
		},
	},
	...over,
});

const setup = (
	steps: readonly StoredBuildStep[],
	jobId: string | null = "j1",
) => {
	const history = new InMemoryHistoryQuery();
	history.callsReply = {
		items: [call(jobId)],
		total: 1,
		page: 1,
		perPage: 20,
	};
	history.stepsReply = steps;
	return { history, matches: makeLastScreenMatches({ history }) };
};

describe("makeLastScreenMatches: report.matches del último kit/build-screen@1", () => {
	it("da las coincidencias del paso de esa pantalla que acabó bien", () => {
		const { matches } = setup([step("kit/build-screen@1 · inicio")]);
		assert.deepEqual(matches("inicio"), [
			{ node: "1:1", set: "Boton", by: "rule:boton" },
			{ node: "1:2", set: "Icono", by: "fingerprint" },
		]);
	});

	it("pide al histórico las últimas llamadas de figma_build con job, la más nueva primero", () => {
		const { history, matches } = setup([step("kit/build-screen@1 · inicio")]);
		matches("inicio");
		const q = history.callsCalls[0];
		assert.equal(q?.tool, "figma_build");
		assert.equal(q?.status, "ok");
		assert.equal(q?.jobsOnly, true);
		assert.deepEqual(q?.sort, { key: "time", dir: "desc" });
		assert.equal(q?.page, 1);
		assert.ok((q?.perPage ?? 0) > 0);
	});

	it("ignora el paso de otra pantalla, uno que falló y uno cuyo resultado no cupo en línea", () => {
		for (const wrong of [
			step("kit/build-screen@1 · otra"),
			step("kit/build-screen@1 · inicio", { status: "failed" }),
			step("kit/build-screen@1 · inicio", {
				result: { kind: "file", path: "/x.json", bytes: 9 },
			}),
			step("kit/build-screen@1 · inicio", { result: null }),
			step("kit/place@1 · inicio"),
		]) {
			const { matches } = setup([wrong]);
			assert.deepEqual(matches("inicio"), []);
		}
	});

	it("una llamada sin job o un informe sin `matches` válidas no da nada, ni rompe", () => {
		assert.deepEqual(
			setup([step("kit/build-screen@1 · inicio")], null).matches("inicio"),
			[],
		);
		const odd = step("kit/build-screen@1 · inicio", {
			result: {
				kind: "inline",
				value: { report: { matches: [{ node: 1 }, "x", null] } },
			},
		});
		assert.deepEqual(setup([odd]).matches("inicio"), []);
		const noReport = step("kit/build-screen@1 · inicio", {
			result: { kind: "inline", value: "texto" },
		});
		assert.deepEqual(setup([noReport]).matches("inicio"), []);
	});

	it("de varias construcciones, la primera (la más reciente) que trae el paso", () => {
		const history = new InMemoryHistoryQuery();
		history.callsReply = {
			items: [call("nuevo"), call("viejo")],
			total: 2,
			page: 1,
			perPage: 20,
		};
		const results: Record<string, readonly StoredBuildStep[]> = {
			nuevo: [],
			viejo: [step("kit/build-screen@1 · inicio")],
		};
		const original = history.steps.bind(history);
		history.steps = (jobId) => {
			original(jobId);
			return results[jobId] ?? [];
		};
		const matches = makeLastScreenMatches({ history });
		assert.equal(matches("inicio").length, 2);
		assert.deepEqual(history.stepsCalls, ["nuevo", "viejo"]);
	});
});
