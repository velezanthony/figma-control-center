import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChatSessionInfo } from "#web/lib/contract.ts";
import { relativeAgo, sessionLabel } from "./session-label.ts";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");
const session = (over: Partial<ChatSessionInfo> = {}): ChatSessionInfo => ({
	sessionId: "3f9d5c00-aaaa-4bbb-8ccc-0123456789ab",
	pid: 4242,
	startedAt: "2026-01-01T10:59:30.000Z",
	lastSeenAt: "2026-01-01T11:59:00.000Z",
	alive: true,
	...over,
});

describe("sessionLabel", () => {
	it("«Sesión de las HH:MM · activa» con la hora local de arranque, sin ids ni pid", () => {
		const label = sessionLabel(session(), "Europe/Madrid");
		assert.equal(label, "Sesión de las 11:59 · activa");
		assert.doesNotMatch(label, /3f9d|4242/);
	});

	it("una sesión que ya no vive se dice terminada", () => {
		assert.equal(
			sessionLabel(session({ alive: false }), "Europe/Madrid"),
			"Sesión de las 11:59 · terminada",
		);
	});
});

describe("relativeAgo", () => {
	const at = (secondsAgo: number) =>
		new Date(NOW - secondsAgo * 1000).toISOString();

	it("menos de un minuto es «ahora mismo»", () => {
		assert.equal(relativeAgo(at(0), NOW), "ahora mismo");
		assert.equal(relativeAgo(at(59), NOW), "ahora mismo");
	});

	it("minutos, horas y días con su unidad", () => {
		assert.equal(relativeAgo(at(60), NOW), "hace 1 min");
		assert.equal(relativeAgo(at(59 * 60), NOW), "hace 59 min");
		assert.equal(relativeAgo(at(3600), NOW), "hace 1 h");
		assert.equal(relativeAgo(at(5 * 3600 + 120), NOW), "hace 5 h");
		assert.equal(relativeAgo(at(2 * 86400), NOW), "hace 2 d");
	});

	it("una hora en el futuro (reloj desajustado) no sale negativa", () => {
		assert.equal(relativeAgo(at(-30), NOW), "ahora mismo");
	});
});
