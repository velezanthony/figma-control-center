import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	type ActivityEvent,
} from "#domain/activity.ts";
import { createActivityFeed } from "./activity-feed.ts";
import type { StoredEvent } from "./ports/activity-source.ts";
import { InMemoryActivitySource } from "./testing/in-memory-activity-source.ts";

const event = (callId: string): ActivityEvent => ({
	v: ACTIVITY_VERSION,
	at: "2026-01-01T00:00:00.000Z",
	sessionId: "s1",
	type: ACTIVITY_TYPE.toolCalled,
	callId,
	tool: "figma_status",
	args: {},
});

const idsOf = (events: readonly StoredEvent[]) => events.map((s) => s.id);
const calls = (events: readonly StoredEvent[]) =>
	events.map((s) =>
		s.event.type === ACTIVITY_TYPE.toolCalled ? s.event.callId : "?",
	);

function setup(replayLimit = 3, initial: string[] = []) {
	const source = new InMemoryActivitySource();
	source.seed(...initial.map(event));
	const feed = createActivityFeed({ source, replayLimit });
	feed.start();
	return { source, feed };
}

describe("createActivityFeed (SSE por id del último evento)", () => {
	it("un cliente nuevo no recibe historial: la web lo pide a la API", () => {
		const { feed } = setup(3, ["a", "b"]);
		const sub = feed.subscribe(() => {}, null);
		assert.deepEqual(sub.replay, []);
		assert.equal(sub.latestId, 2);
	});

	it("los eventos nuevos llegan a los suscritos con su id", () => {
		const { feed, source } = setup(3, ["a"]);
		const received: StoredEvent[] = [];
		feed.subscribe((e) => received.push(...e), null);
		source.emit(event("x"), event("y"));
		assert.deepEqual(idsOf(received), [2, 3]);
		assert.deepEqual(calls(received), ["x", "y"]);
	});

	it("quien reconecta con su último id recibe lo que se perdió, hasta el tope", () => {
		const { feed, source } = setup(2, ["a", "b", "c", "d", "e"]);
		const sub = feed.subscribe(() => {}, 1);
		assert.deepEqual(idsOf(sub.replay), [2, 3]);
		assert.equal(sub.latestId, source.latestId());
	});

	it("lo repetido entre el reenvío y el seguimiento no se entrega dos veces", () => {
		const { feed, source } = setup(10, ["a"]);
		const pending = source.registerSilently(event("b"), event("c"));
		const received: StoredEvent[] = [];
		const sub = feed.subscribe((e) => received.push(...e), 1);
		assert.deepEqual(idsOf(sub.replay), [2, 3]);
		source.deliver(pending);
		assert.deepEqual(received, []);
		source.emit(event("d"));
		assert.deepEqual(idsOf(received), [4]);
	});

	it("un id mayor que el último (base nueva) se trata como cliente nuevo", () => {
		const { feed, source } = setup(3, ["a"]);
		const received: StoredEvent[] = [];
		const sub = feed.subscribe((e) => received.push(...e), 500);
		assert.deepEqual(sub.replay, []);
		source.emit(event("b"));
		assert.deepEqual(idsOf(received), [2]);
	});

	it("quien se da de baja deja de recibir", () => {
		const { feed, source } = setup();
		const received: StoredEvent[] = [];
		const sub = feed.subscribe((e) => received.push(...e), null);
		source.emit(event("a"));
		sub.unsubscribe();
		source.emit(event("b"));
		assert.deepEqual(calls(received), ["a"]);
	});

	it("un suscrito que falla no impide avisar a los demás", () => {
		const { feed, source } = setup();
		const received: StoredEvent[] = [];
		feed.subscribe(() => {
			throw new Error("socket cerrado");
		}, null);
		feed.subscribe((e) => received.push(...e), null);
		source.emit(event("a"));
		assert.deepEqual(calls(received), ["a"]);
	});

	it("stop deja de vigilar la fuente", () => {
		const { feed, source } = setup();
		assert.equal(source.following, true);
		feed.stop();
		assert.equal(source.following, false);
	});
});
