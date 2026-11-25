import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRange } from "./history-range.ts";

// Hora local a propósito: «hoy» es el día del reloj de la máquina, y el test no depende de su zona horaria
const NOW = new Date(2026, 5, 1, 15, 30, 0);
const HOUR_MS = 3_600_000;

const value = (input: Parameters<typeof resolveRange>[0]) => {
	const r = resolveRange(input, NOW);
	assert.ok(r.ok, r.ok ? "" : r.error.message);
	return r.value;
};
const error = (input: Parameters<typeof resolveRange>[0]) => {
	const r = resolveRange(input, NOW);
	assert.ok(!r.ok, "se esperaba un error");
	return r.error;
};

describe("resolveRange", () => {
	it("sin nada pide todo el histórico", () => {
		assert.deepEqual(value({}), { fromMs: null, toMs: null, sessionId: null });
	});

	it("last_hour empieza una hora antes de ahora y no tiene fin", () => {
		assert.deepEqual(value({ preset: "last_hour" }), {
			fromMs: NOW.getTime() - HOUR_MS,
			toMs: null,
			sessionId: null,
		});
	});

	it("today empieza a medianoche local", () => {
		assert.equal(
			value({ preset: "today" }).fromMs,
			new Date(2026, 5, 1, 0, 0, 0).getTime(),
		);
	});

	it("since y until se leen como ISO", () => {
		const r = value({
			since: "2026-05-31T10:00:00.000Z",
			until: "2026-06-01T10:00:00.000Z",
		});
		assert.equal(r.fromMs, Date.parse("2026-05-31T10:00:00.000Z"));
		assert.equal(r.toMs, Date.parse("2026-06-01T10:00:00.000Z"));
	});

	it("la sesión se acota junto con el tiempo", () => {
		assert.deepEqual(
			value({ preset: "last_hour", sessionId: "abc" }).sessionId,
			"abc",
		);
		assert.deepEqual(value({ sessionId: "abc" }), {
			fromMs: null,
			toMs: null,
			sessionId: "abc",
		});
	});

	it("una fecha que no es ISO es un error de uso que nombra el campo", () => {
		const e = error({ since: "ayer" });
		assert.equal(e.type, "InvalidRange");
		assert.match(e.message, /since/);
		assert.match(error({ until: "mañana" }).message, /until/);
	});

	it("since posterior a until es un error", () => {
		const e = error({
			since: "2026-06-02T00:00:00Z",
			until: "2026-06-01T00:00:00Z",
		});
		assert.equal(e.type, "InvalidRange");
	});

	it("preset junto con since o until es ambiguo: error", () => {
		assert.equal(
			error({ preset: "today", since: "2026-06-01T00:00:00Z" }).type,
			"InvalidRange",
		);
		assert.equal(
			error({ preset: "last_hour", until: "2026-06-01T00:00:00Z" }).type,
			"InvalidRange",
		);
	});
});
