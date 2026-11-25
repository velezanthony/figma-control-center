import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
	ChatMessage,
	PermissionRequest,
	PermissionStatus,
} from "#web/lib/contract.ts";
import { buildTimeline, waitingNotice } from "./timeline.ts";

const msg = (id: number, at: string): ChatMessage => ({
	id,
	sessionId: "s",
	direction: "in",
	chatId: "c",
	body: `m${id}`,
	at: `2026-01-01T10:${at}.000Z`,
	status: "delivered",
});
const perm = (
	id: number,
	at: string,
	status: PermissionStatus = "pending",
): PermissionRequest => ({
	id,
	sessionId: "s",
	requestId: "abcde",
	toolName: "Bash",
	description: "d",
	inputPreview: "{}",
	at: `2026-01-01T10:${at}.000Z`,
	status,
	decidedAt: null,
});
const keys = (items: ReturnType<typeof buildTimeline>) =>
	items.map((i) => i.key);

describe("buildTimeline: mensajes y permisos intercalados por hora", () => {
	it("pone cada petición entre los mensajes según su hora, pendientes y contestadas", () => {
		const timeline = buildTimeline(
			[msg(1, "00:00"), msg(2, "02:00"), msg(3, "04:00")],
			[perm(7, "01:00", "allowed"), perm(8, "03:00")],
			false,
		);
		assert.deepEqual(
			timeline.map((i) => i.kind),
			["message", "permission", "message", "permission", "message"],
		);
	});

	it("las peticiones llevan claves negativas que no chocan con los ids de mensaje", () => {
		const timeline = buildTimeline(
			[msg(1, "00:00")],
			[perm(1, "01:00")],
			false,
		);
		assert.deepEqual(keys(timeline), [1, -1]);
	});

	it("a la misma hora, el mensaje va antes que la petición", () => {
		const timeline = buildTimeline(
			[msg(1, "00:00")],
			[perm(5, "00:00")],
			false,
		);
		assert.deepEqual(keys(timeline), [1, -5]);
	});

	it("sin mensajes, solo las peticiones en su orden", () => {
		assert.deepEqual(
			keys(buildTimeline([], [perm(2, "02:00"), perm(1, "01:00")], false)),
			[-1, -2],
		);
	});

	it("con historial sin cargar, una contestada anterior al primer mensaje cargado espera a que se cargue; una pendiente sale siempre", () => {
		const timeline = buildTimeline(
			[msg(10, "05:00"), msg(11, "06:00")],
			[
				perm(1, "01:00", "denied"),
				perm(2, "02:00"),
				perm(3, "05:30", "allowed"),
			],
			true,
		);
		assert.deepEqual(keys(timeline), [-2, 10, -3, 11]);
	});
});

describe("waitingNotice: cuándo sale el aviso de permisos esperando", () => {
	const timeline = buildTimeline(
		[msg(1, "00:00"), msg(2, "02:00")],
		[perm(7, "01:00", "allowed"), perm(8, "03:00"), perm(9, "04:00")],
		false,
	);

	it("sin pendientes no sale", () => {
		const decided = buildTimeline(
			[msg(1, "00:00")],
			[perm(7, "01:00", "allowed")],
			false,
		);
		assert.equal(waitingNotice(decided, new Set()), null);
	});

	it("con todas las pendientes a la vista no sale", () => {
		assert.equal(waitingNotice(timeline, new Set([-8, -9])), null);
	});

	it("si alguna pendiente no se ve, cuenta todas las pendientes y lleva a la primera que no se ve", () => {
		assert.deepEqual(waitingNotice(timeline, new Set([-8])), {
			count: 2,
			target: -9,
		});
		assert.deepEqual(waitingNotice(timeline, new Set([1, 2])), {
			count: 2,
			target: -8,
		});
	});

	it("sin saber aún qué se ve (la lista no se ha colocado), no sale", () => {
		assert.equal(waitingNotice(timeline, null), null);
	});
});
