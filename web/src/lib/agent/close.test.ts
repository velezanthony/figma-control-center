import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	CLOSE_CONFIRM,
	CLOSE_INIT,
	CLOSE_PATH,
	closeButtonState,
	closePath,
	closeSettled,
	LAUNCHES_PATH,
	NO_AGENT_REASON,
	parseCloseResponse,
	parseLaunchesResponse,
	runningBatchPath,
} from "./close.ts";

const LAUNCH = "6e9b6885-0a1b-4c2d-8e3f-0123456789ab";

describe("rutas de «Cerrar agente»", () => {
	it("son las mismas que el servidor (AGENT_ROUTE)", () => {
		assert.equal(CLOSE_PATH, "/api/agent/close");
		assert.equal(LAUNCHES_PATH, "/api/agent/launches");
	});

	it("cerrar lleva solo ?launch=<id>, y sin cuerpo", () => {
		assert.equal(closePath(LAUNCH), `/api/agent/close?launch=${LAUNCH}`);
		assert.equal(closePath("a b"), "/api/agent/close?launch=a%20b");
		assert.deepEqual(CLOSE_INIT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
	});

	it("un lote en curso se pregunta al histórico: figma_build en curso, solo jobs", () => {
		const url = new URL(runningBatchPath(), "http://x");
		assert.equal(url.pathname, "/api/history/calls");
		assert.equal(url.searchParams.get("tool"), "figma_build");
		assert.equal(url.searchParams.get("status"), "running");
		assert.equal(url.searchParams.get("jobs"), "1");
	});
});

describe("closeButtonState", () => {
	it("sin agente lanzado desde el panel: desactivado con el motivo en el tooltip", () => {
		assert.deepEqual(
			closeButtonState({ launchId: null, batchRunning: false }),
			{ disabled: true, reason: NO_AGENT_REASON, confirm: null },
		);
		assert.equal(
			NO_AGENT_REASON,
			"No hay ningún agente abierto desde el panel",
		);
	});

	it("sin agente, aunque haya lote, sigue desactivado y no pide confirmación", () => {
		assert.deepEqual(closeButtonState({ launchId: null, batchRunning: true }), {
			disabled: true,
			reason: NO_AGENT_REASON,
			confirm: null,
		});
	});

	it("con agente y sin lote: activo y cierra sin preguntar", () => {
		assert.deepEqual(
			closeButtonState({ launchId: LAUNCH, batchRunning: false }),
			{ disabled: false, reason: null, confirm: null },
		);
	});

	it("con agente y un lote en curso: pide confirmación", () => {
		assert.deepEqual(
			closeButtonState({ launchId: LAUNCH, batchRunning: true }),
			{ disabled: false, reason: null, confirm: CLOSE_CONFIRM },
		);
		assert.equal(
			CLOSE_CONFIRM,
			"Hay un lote en curso: si cierras el agente, el lote queda interrumpido. ¿Cerrar igualmente?",
		);
	});
});

describe("respuestas del servidor", () => {
	it("los agentes abiertos: el primero, o null si no hay o la respuesta no vale", () => {
		assert.equal(
			parseLaunchesResponse({ ok: true, items: [{ launchId: LAUNCH }] }),
			LAUNCH,
		);
		for (const bad of [
			{ ok: true, items: [] },
			{ ok: false },
			null,
			{ ok: true, items: [{ launchId: 3 }] },
		]) {
			assert.equal(parseLaunchesResponse(bad), null, JSON.stringify(bad));
		}
	});

	it("cerrar: 202 vale; un error trae el mensaje del servidor o uno genérico", () => {
		assert.deepEqual(parseCloseResponse(202, { ok: true }), { ok: true });
		assert.deepEqual(
			parseCloseResponse(409, {
				ok: false,
				error: { type: "AgentNotWatching", message: "no está conectado" },
			}),
			{ ok: false, message: "no está conectado" },
		);
		assert.deepEqual(parseCloseResponse(500, null), {
			ok: false,
			message: "No se pudo cerrar el agente. (HTTP 500)",
		});
	});
});

describe("closeSettled (cuándo deja de mirarse un cierre pedido)", () => {
	const OTHER = "otra";
	const AGENT = "agente";
	const aliveAtClose = new Set([AGENT, OTHER]);

	it("mientras siga el lanzamiento, no ha terminado", () => {
		assert.equal(
			closeSettled({ launchId: LAUNCH, aliveAtClose, sessions: [] }),
			false,
		);
	});

	it("sin lanzamiento pero con la sesión del agente aún activa, sigue mirando (el selector la diría activa)", () => {
		assert.equal(
			closeSettled({
				launchId: null,
				aliveAtClose,
				sessions: [
					{ sessionId: AGENT, alive: true },
					{ sessionId: OTHER, alive: true },
				],
			}),
			false,
		);
	});

	it("sin lanzamiento y con una de las sesiones de entonces ya terminada (o desaparecida), ha terminado", () => {
		assert.equal(
			closeSettled({
				launchId: null,
				aliveAtClose,
				sessions: [
					{ sessionId: AGENT, alive: false },
					{ sessionId: OTHER, alive: true },
				],
			}),
			true,
		);
		assert.equal(
			closeSettled({
				launchId: null,
				aliveAtClose,
				sessions: [{ sessionId: OTHER, alive: true }],
			}),
			true,
		);
	});

	it("si al cerrar no había ninguna sesión activa, basta con que se vaya el lanzamiento", () => {
		assert.equal(
			closeSettled({ launchId: null, aliveAtClose: new Set(), sessions: [] }),
			true,
		);
	});
});
