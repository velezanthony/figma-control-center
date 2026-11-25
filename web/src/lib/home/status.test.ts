import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ConnectionStatus } from "#web/lib/contract.ts";
import {
	connectionRows,
	connectionSummary,
	type HomeInput,
	type PanelConnection,
	statusRows,
} from "./status.ts";

const READY: ConnectionStatus = {
	at: "2026-01-01T00:00:00.000Z",
	chromeReachable: true,
	tabFound: true,
	figmaReady: true,
	fileName: "Sistema",
	pageName: "Portada",
};
const base: HomeInput = {
	connection: "open",
	status: READY,
	agentActive: true,
	agentWaiting: false,
};
const rowOf = (over: Partial<HomeInput>, id: string) => {
	const row = statusRows({ ...base, ...over }).find((r) => r.id === id);
	assert.ok(row, id);
	return row;
};

describe("statusRows", () => {
	it("todo en orden: cuatro filas en verde, sin siguiente paso", () => {
		const rows = statusRows(base);
		assert.deepEqual(
			rows.map((r) => [r.id, r.health]),
			[
				["panel", "ok"],
				["chrome", "ok"],
				["figma", "ok"],
				["agent", "ok"],
			],
		);
		assert.ok(rows.every((r) => r.next === null));
		assert.equal(rowOf({}, "figma").detail, "Sistema · Portada");
	});

	it("panel sin conexión: error con el comando para arrancarlo", () => {
		const row = rowOf({ connection: "closed" }, "panel");
		assert.equal(row.health, "error");
		assert.equal(row.next?.command, "make dashboard");
	});

	it("panel conectando: aviso sin siguiente paso", () => {
		const row = rowOf({ connection: "connecting" }, "panel");
		assert.deepEqual([row.health, row.next], ["warning", null]);
	});

	it("sin comprobar nunca el estado, Chrome y Figma están sin comprobar y se explica cómo se comprueba", () => {
		for (const id of ["chrome", "figma"]) {
			const row = rowOf({ status: null }, id);
			assert.equal(row.health, "idle", id);
			assert.match(row.next?.text ?? "", /figma_status/);
		}
	});

	it("Chrome caído: error con «make chrome»; Figma pasa a sin comprobar", () => {
		const down = {
			...READY,
			chromeReachable: false,
			tabFound: false,
			figmaReady: false,
		};
		const chrome = rowOf({ status: down }, "chrome");
		assert.deepEqual(
			[chrome.health, chrome.next?.command],
			["error", "make chrome"],
		);
		assert.equal(rowOf({ status: down }, "figma").health, "idle");
	});

	it("sin pestaña de Figma: aviso que pide abrir el archivo", () => {
		const row = rowOf(
			{ status: { ...READY, tabFound: false, figmaReady: false } },
			"figma",
		);
		assert.equal(row.health, "warning");
		assert.match(row.next?.text ?? "", /Proyectos/);
		assert.doesNotMatch(row.next?.text ?? "", /FIGMA_FILE_URL|\.env/);
	});

	it("pestaña abierta pero Figma sin cargar: aviso distinto", () => {
		const row = rowOf({ status: { ...READY, figmaReady: false } }, "figma");
		assert.equal(row.health, "warning");
		assert.match(row.label, /no está listo/);
	});

	it("sin agente: aviso con la acción de lanzarlo", () => {
		const row = rowOf({ agentActive: false }, "agent");
		assert.deepEqual(
			[row.health, row.next?.action],
			["warning", "launch-agent"],
		);
	});

	it("agente arrancando: aviso sin acción (ya está en marcha)", () => {
		const row = rowOf({ agentActive: false, agentWaiting: true }, "agent");
		assert.equal(row.health, "warning");
		assert.equal(row.next?.action ?? null, null);
	});
});

describe("connectionSummary (pie de la barra lateral)", () => {
	const summaryOf = (
		connection: PanelConnection,
		status: ConnectionStatus | null,
	) => connectionSummary(connectionRows(connection, status));

	it("panel, Chrome y Figma bien: «Todo listo · en vivo» en verde", () => {
		assert.deepEqual(summaryOf("open", READY), {
			health: "ok",
			text: "Todo listo · en vivo",
		});
	});

	it("las filas de conexión son las tres primeras de Inicio, sin el agente", () => {
		assert.deepEqual(
			connectionRows("open", READY).map((r) => r.id),
			["panel", "chrome", "figma"],
		);
	});

	it("un error gana a un aviso aunque venga después", () => {
		const down = {
			...READY,
			chromeReachable: false,
			tabFound: false,
			figmaReady: false,
		};
		assert.deepEqual(summaryOf("connecting", down), {
			health: "error",
			text: "Chrome no responde",
		});
	});

	it("con avisos, dice el primero", () => {
		assert.deepEqual(
			summaryOf("open", { ...READY, tabFound: false, figmaReady: false }),
			{
				health: "warning",
				text: "Sin pestaña de Figma",
			},
		);
		assert.deepEqual(summaryOf("connecting", READY), {
			health: "warning",
			text: "Conectando…",
		});
	});

	it("sin comprobar todavía, lo dice sin pintarlo de error", () => {
		assert.deepEqual(summaryOf("open", null), {
			health: "idle",
			text: "Chrome sin comprobar",
		});
	});

	it("sin panel, error aunque Figma estuviera bien", () => {
		assert.deepEqual(summaryOf("closed", READY), {
			health: "error",
			text: "Sin conexión con el panel",
		});
	});
});
