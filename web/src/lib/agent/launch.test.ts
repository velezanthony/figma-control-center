import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChatSessionInfo } from "#web/lib/contract.ts";
import {
	appearedSession,
	LAUNCH_INIT,
	LAUNCH_PATH,
	launchPath,
	parseLaunchResponse,
	waitExpired,
} from "./launch.ts";

const session = (id: string, lastSeenAt: string): ChatSessionInfo => ({
	sessionId: id,
	pid: 1,
	startedAt: lastSeenAt,
	lastSeenAt,
	alive: true,
});

describe("lanzar el agente: la petición", () => {
	it("es un POST a la ruta del servidor, con JSON y sin cuerpo: el navegador no manda comandos", () => {
		assert.equal(LAUNCH_PATH, "/api/agent/launch");
		assert.equal(LAUNCH_INIT.method, "POST");
		assert.deepEqual(LAUNCH_INIT.headers, {
			"Content-Type": "application/json",
		});
		assert.equal(LAUNCH_INIT.body, undefined);
	});
});

describe("launchPath: el proyecto que se lanza", () => {
	it("sin proyecto es la ruta de siempre", () => {
		assert.equal(launchPath(null), LAUNCH_PATH);
	});

	it("con proyecto, lo pasa en ?project (codificado)", () => {
		assert.equal(launchPath("ejemplo"), `${LAUNCH_PATH}?project=ejemplo`);
		assert.equal(launchPath("a b"), `${LAUNCH_PATH}?project=a%20b`);
	});
});

describe("parseLaunchResponse", () => {
	it("un 202 con ok trae el id, el instante de inicio y el plazo que fija el servidor", () => {
		assert.deepEqual(
			parseLaunchResponse(202, {
				ok: true,
				launchId: "abc",
				startedAt: "2026-01-01T10:00:00.000Z",
				timeoutMs: 90_000,
			}),
			{
				ok: true,
				launchId: "abc",
				startedAtMs: Date.parse("2026-01-01T10:00:00.000Z"),
				timeoutMs: 90_000,
			},
		);
	});

	it("un error del servidor trae su mensaje", () => {
		assert.deepEqual(
			parseLaunchResponse(409, {
				ok: false,
				error: { type: "LaunchInProgress", message: "Ya hay uno" },
			}),
			{ ok: false, message: "Ya hay uno" },
		);
	});

	it("una respuesta que no es lo esperado es un error genérico, no una excepción", () => {
		const incomplete = {
			ok: true,
			launchId: "a",
			startedAt: "2026-01-01T10:00:00.000Z",
		};
		const badDate = { ...incomplete, startedAt: "ayer", timeoutMs: 1 };
		for (const body of [
			null,
			"x",
			{},
			{ ok: true },
			{ ok: false },
			{ ok: true, pid: 12 },
			incomplete,
			badDate,
		]) {
			const r = parseLaunchResponse(500, body);
			assert.equal(r.ok, false, JSON.stringify(body));
		}
	});
});

describe("appearedSession", () => {
	it("devuelve la sesión que no estaba al lanzar", () => {
		const items = [
			session("nueva", "2026-01-02"),
			session("vieja", "2026-01-01"),
		];
		assert.equal(appearedSession(new Set(["vieja"]), items), "nueva");
	});

	it("sin sesiones nuevas, null", () => {
		const items = [session("vieja", "2026-01-01")];
		assert.equal(appearedSession(new Set(["vieja"]), items), null);
		assert.equal(appearedSession(new Set(), []), null);
	});

	it("si aparecen varias, la más reciente", () => {
		const items = [
			session("a", "2026-01-01"),
			session("b", "2026-01-03"),
			session("c", "2026-01-02"),
		];
		assert.equal(appearedSession(new Set(), items), "b");
	});
});

describe("waitExpired", () => {
	it("la espera vence al cumplirse el plazo que dio el servidor, sea cual sea", () => {
		assert.equal(waitExpired(1_000, 90_000, 1_000 + 89_999), false);
		assert.equal(waitExpired(1_000, 90_000, 1_000 + 90_000), true);
		assert.equal(waitExpired(1_000, 5_000, 1_000 + 5_000), true);
	});
});
