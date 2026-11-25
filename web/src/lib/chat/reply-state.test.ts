import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChatMessage } from "#web/lib/contract.ts";
import {
	deliveryLabel,
	elapsedLabel,
	pendingCursor,
	replyState,
	SLOW_REPLY_MS,
	STALLED_REPLY_MS,
} from "./reply-state.ts";

const T0 = Date.parse("2026-01-01T10:00:00.000Z");
const msg = (
	id: number,
	direction: "in" | "out",
	over: Partial<ChatMessage> = {},
): ChatMessage => ({
	id,
	sessionId: "s1",
	direction,
	chatId: "c",
	body: `m${id}`,
	at: "2026-01-01T10:00:00.000Z",
	status: "delivered",
	...over,
});

describe("replyState: la máquina de espera de la respuesta", () => {
	it("sin mensajes, o con la última pregunta ya respondida, no se espera nada", () => {
		assert.deepEqual(replyState([], T0), { kind: "idle" });
		assert.deepEqual(replyState([msg(1, "in"), msg(2, "out")], T0 + 99_000), {
			kind: "idle",
		});
	});

	it("una pregunta recién enviada que la sesión aún no ha recogido está en cola", () => {
		assert.deepEqual(replyState([msg(1, "in", { status: "pending" })], T0), {
			kind: "queued",
		});
	});

	it("una pregunta entregada sin respuesta es «pensando», con los segundos que lleva", () => {
		assert.deepEqual(replyState([msg(1, "in")], T0 + 14_900), {
			kind: "thinking",
			elapsedSec: 14,
			slow: false,
			stalled: false,
		});
	});

	it("los segundos nunca salen negativos aunque el reloj del navegador vaya por detrás", () => {
		const s = replyState([msg(1, "in")], T0 - 5_000);
		assert.equal(s.kind === "thinking" && s.elapsedSec, 0);
	});

	it("pasado el plazo sin respuesta se avisa con calma (slow)", () => {
		const justBefore = replyState([msg(1, "in")], T0 + SLOW_REPLY_MS - 1);
		const atLimit = replyState([msg(1, "in")], T0 + SLOW_REPLY_MS);
		assert.equal(justBefore.kind === "thinking" && justBefore.slow, false);
		assert.equal(atLimit.kind === "thinking" && atLimit.slow, true);
	});

	it("el plazo es configurable por quien llama", () => {
		const s = replyState([msg(1, "in")], T0 + 5_000, 5_000);
		assert.equal(s.kind === "thinking" && s.slow, true);
	});

	it("pasado el plazo largo sin respuesta se sugiere arrancar el agente (stalled)", () => {
		const justBefore = replyState([msg(1, "in")], T0 + STALLED_REPLY_MS - 1);
		const atLimit = replyState([msg(1, "in")], T0 + STALLED_REPLY_MS);
		assert.equal(justBefore.kind === "thinking" && justBefore.stalled, false);
		assert.equal(atLimit.kind === "thinking" && atLimit.stalled, true);
	});

	it("el plazo de «estancado» también es configurable", () => {
		const s = replyState([msg(1, "in")], T0 + 5_000, 1_000, 5_000);
		assert.equal(s.kind === "thinking" && s.stalled, true);
	});

	it("un mensaje rechazado nunca llegó a Claude: «no entregado», no una espera", () => {
		assert.deepEqual(replyState([msg(1, "in", { status: "rejected" })], T0), {
			kind: "undelivered",
		});
	});

	it("solo cuenta la última pregunta: una respuesta anterior no la tapa", () => {
		const s = replyState(
			[msg(1, "in"), msg(2, "out"), msg(3, "in")],
			T0 + 3_000,
		);
		assert.equal(s.kind, "thinking");
	});

	it("no depende del orden en que llegan los mensajes", () => {
		const s = replyState([msg(2, "out"), msg(1, "in")], T0);
		assert.equal(s.kind, "idle");
	});
});

describe("deliveryLabel", () => {
	it("dice el estado de entrega de lo que escribe el usuario, con las palabras de la interfaz", () => {
		assert.equal(deliveryLabel("pending"), "Enviando…");
		assert.equal(deliveryLabel("delivered"), "Entregado a la sesión");
		assert.equal(deliveryLabel("rejected"), "No entregado");
	});
});

describe("elapsedLabel", () => {
	it("segundos hasta el minuto y luego minutos con segundos de dos cifras", () => {
		assert.equal(elapsedLabel(0), "0 s");
		assert.equal(elapsedLabel(14), "14 s");
		assert.equal(elapsedLabel(59), "59 s");
		assert.equal(elapsedLabel(60), "1 min 00 s");
		assert.equal(elapsedLabel(125), "2 min 05 s");
	});
});

describe("pendingCursor: desde dónde volver a pedir para ver cambiar el estado de entrega", () => {
	it("sin mensajes pendientes del usuario no hace falta preguntar", () => {
		assert.equal(pendingCursor([]), null);
		assert.equal(pendingCursor([msg(1, "in"), msg(2, "out")]), null);
	});

	it("con uno pendiente, el cursor es el id anterior al más antiguo pendiente", () => {
		const ms = [
			msg(4, "in", { status: "pending" }),
			msg(7, "in", { status: "pending" }),
		];
		assert.equal(pendingCursor(ms), 3);
	});

	it("una respuesta de Claude pendiente no cuenta: solo lo que escribe el usuario", () => {
		assert.equal(pendingCursor([msg(2, "out", { status: "pending" })]), null);
	});
});
