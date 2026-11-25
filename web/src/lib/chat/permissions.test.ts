import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PermissionRequest, PermissionStatus } from "#web/lib/contract.ts";
import {
	announcement,
	compactInput,
	decisionError,
	EXPIRED_HINT,
	noticeLabel,
	STATUS_LABEL,
} from "./permissions.ts";

const req = (
	id: number,
	status: PermissionStatus,
	toolName = "Bash",
): PermissionRequest => ({
	id,
	sessionId: "s",
	requestId: "abcde",
	toolName,
	description: "d",
	inputPreview: "{}",
	at: "2026-01-01T00:00:00.000Z",
	status,
	decidedAt: null,
});

describe("announcement", () => {
	it("nombra la herramienta si hay una pendiente, las cuenta si hay varias y calla si no hay", () => {
		assert.equal(
			announcement([req(1, "pending", "Write")]),
			"Claude pide permiso para usar Write",
		);
		assert.equal(
			announcement([req(1, "pending"), req(2, "pending")]),
			"Claude pide permiso para 2 acciones",
		);
		assert.equal(announcement([req(1, "allowed")]), "");
	});
});

describe("textos", () => {
	it("cada estado tiene su etiqueta y la caducada no afirma quién contestó", () => {
		assert.equal(STATUS_LABEL.allowed, "Aprobada");
		assert.equal(STATUS_LABEL.denied, "Denegada");
		assert.match(EXPIRED_HINT, /puede que/);
	});

	it("decisionError usa el mensaje del servidor y, si no lo hay, el de reserva", () => {
		assert.equal(
			decisionError(
				{ ok: false, error: { message: "Ya está contestada." } },
				"x",
			),
			"Ya está contestada.",
		);
		assert.equal(decisionError(null, "reserva"), "reserva");
		assert.equal(decisionError({ error: {} }, "reserva"), "reserva");
	});
});

describe("compactInput", () => {
	it("pone un JSON de objeto o lista en una sola línea, sin sangría", () => {
		assert.equal(
			compactInput(
				'{\n  "steps": [ { "file": "/a.js" } ],\n  "stopOnError": true\n}',
			),
			'{"steps":[{"file":"/a.js"}],"stopOnError":true}',
		);
	});

	it("deja tal cual lo que no es JSON (una vista previa recortada, texto suelto)", () => {
		assert.equal(compactInput('{"command":"ls -la'), '{"command":"ls -la');
		assert.equal(compactInput("ls -la"), "ls -la");
	});

	it("deja tal cual un valor JSON que no es objeto ni lista", () => {
		assert.equal(compactInput('"hola"'), '"hola"');
		assert.equal(compactInput("42"), "42");
	});
});

describe("noticeLabel", () => {
	it("cuenta los permisos que esperan, en singular y en plural", () => {
		assert.equal(noticeLabel(1), "1 permiso esperando");
		assert.equal(noticeLabel(3), "3 permisos esperando");
	});
});
