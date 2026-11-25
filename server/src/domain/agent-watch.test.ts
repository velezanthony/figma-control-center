import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isLaunchId,
	launchIdOfDir,
	WATCH_START,
	type WatchInput,
	type WatchState,
	watchStep,
} from "./agent-watch.ts";

const TIMING = { graceMs: 10_000, retryMs: 1000 } as const;

// Aplica las entradas en orden y devuelve el estado final y los efectos que pidió cada una
const run = (inputs: readonly WatchInput[], from: WatchState = WATCH_START) => {
	let state = from;
	const effects = inputs.map((input) => {
		const next = watchStep(state, input, TIMING);
		state = next.state;
		return next.effect;
	});
	return { state, effects };
};

describe("watchStep: vigilar al panel", () => {
	it("empieza vigilando y una conexión reconocida no pide nada", () => {
		assert.deepEqual(WATCH_START, { phase: "watching" });
		assert.deepEqual(run([{ type: "connected" }]), {
			state: { phase: "watching" },
			effects: [{ type: "none" }],
		});
	});

	it("al caerse la conexión espera al panel y reintenta pasado el intervalo", () => {
		assert.deepEqual(run([{ type: "disconnected", at: 5000 }]), {
			state: { phase: "waitingPanel", since: 5000 },
			effects: [{ type: "retry", afterMs: 1000 }],
		});
	});

	it("un reintento fallido dentro del margen vuelve a reintentar sin mover el inicio del margen", () => {
		const { state, effects } = run([
			{ type: "disconnected", at: 0 },
			{ type: "disconnected", at: 1000 },
			{ type: "disconnected", at: 9999 },
		]);
		assert.deepEqual(state, { phase: "waitingPanel", since: 0 });
		assert.deepEqual(effects.at(-1), { type: "retry", afterMs: 1000 });
	});

	it("si el panel vuelve dentro del margen y reconoce el lanzamiento, sigue vigilando (CA-2)", () => {
		const { state, effects } = run([
			{ type: "disconnected", at: 0 },
			{ type: "disconnected", at: 1000 },
			{ type: "connected" },
		]);
		assert.deepEqual(state, { phase: "watching" });
		assert.deepEqual(effects.at(-1), { type: "none" });
	});

	it("un margen nuevo empieza de cero tras un reinicio superado", () => {
		const { state, effects } = run([
			{ type: "disconnected", at: 0 },
			{ type: "connected" },
			{ type: "disconnected", at: 60_000 },
			{ type: "disconnected", at: 65_000 },
		]);
		assert.deepEqual(state, { phase: "waitingPanel", since: 60_000 });
		assert.deepEqual(effects.at(-1), { type: "retry", afterMs: 1000 });
	});

	it("si el panel no vuelve en el margen, cierra a claude (CA-1)", () => {
		const { state, effects } = run([
			{ type: "disconnected", at: 0 },
			{ type: "disconnected", at: 10_000 },
		]);
		assert.deepEqual(state, { phase: "closing", reason: "panelGone" });
		assert.deepEqual(effects.at(-1), { type: "shutdown", reason: "panelGone" });
	});

	it("el fin del margen también llega por el reloj, sin un reintento que falle", () => {
		const { state, effects } = run([
			{ type: "disconnected", at: 0 },
			{ type: "tick", at: 9999 },
			{ type: "tick", at: 10_000 },
		]);
		assert.deepEqual(effects, [
			{ type: "retry", afterMs: 1000 },
			{ type: "none" },
			{ type: "shutdown", reason: "panelGone" },
		]);
		assert.deepEqual(state, { phase: "closing", reason: "panelGone" });
	});

	it("el reloj mientras se vigila no hace nada", () => {
		assert.deepEqual(run([{ type: "tick", at: 99_999 }]), {
			state: { phase: "watching" },
			effects: [{ type: "none" }],
		});
	});

	it("el evento close del panel lleva a cerrar (botón «Cerrar agente»)", () => {
		assert.deepEqual(run([{ type: "closeRequested" }]), {
			state: { phase: "closing", reason: "closeRequested" },
			effects: [{ type: "shutdown", reason: "closeRequested" }],
		});
	});

	it("tras el cierre, la salida de claude deja la vigilancia cerrada", () => {
		const { state, effects } = run([
			{ type: "closeRequested" },
			{ type: "claudeExited" },
		]);
		assert.deepEqual(state, { phase: "closed" });
		assert.deepEqual(effects.at(-1), { type: "none" });
	});
});

describe("watchStep: el usuario cierra la consola (CA-3)", () => {
	const states: readonly WatchState[] = [
		{ phase: "watching" },
		{ phase: "waitingPanel", since: 0 },
	];
	for (const from of states) {
		it(`SIGHUP con la vigilancia en «${from.phase}» cierra una sola vez`, () => {
			const { state, effects } = run(
				[{ type: "hangup" }, { type: "hangup" }],
				from,
			);
			assert.deepEqual(effects, [{ type: "userClose" }, { type: "none" }]);
			assert.deepEqual(state, { phase: "closing", reason: "user" });
		});
	}

	it("el fin del margen después de un SIGHUP no hace nada", () => {
		const { state, effects } = run([
			{ type: "disconnected", at: 0 },
			{ type: "hangup" },
			{ type: "tick", at: 10_000 },
			{ type: "disconnected", at: 11_000 },
			{ type: "connected" },
			{ type: "closeRequested" },
		]);
		assert.deepEqual(effects.slice(2), [
			{ type: "none" },
			{ type: "none" },
			{ type: "none" },
			{ type: "none" },
		]);
		assert.deepEqual(state, { phase: "closing", reason: "user" });
	});

	it("SIGHUP mientras ya cerramos nosotros no abre un segundo cierre", () => {
		const { state, effects } = run([
			{ type: "disconnected", at: 0 },
			{ type: "tick", at: 10_000 },
			{ type: "hangup" },
		]);
		assert.deepEqual(effects.at(-1), { type: "none" });
		assert.deepEqual(state, { phase: "closing", reason: "panelGone" });
	});

	it("cerrada la vigilancia, nada la reabre", () => {
		const closed: WatchState = { phase: "closed" };
		const { state, effects } = run(
			[
				{ type: "hangup" },
				{ type: "tick", at: 99_999 },
				{ type: "disconnected", at: 99_999 },
				{ type: "connected" },
				{ type: "closeRequested" },
				{ type: "claudeExited" },
			],
			closed,
		);
		assert.ok(effects.every((e) => e.type === "none"));
		assert.deepEqual(state, closed);
	});
});

describe("isLaunchId y launchIdOfDir: el id de un lanzamiento", () => {
	it("solo vale un UUID en minúsculas, como los que da randomUUID", () => {
		assert.equal(isLaunchId("6e9b6885-0a1b-4c2d-8e3f-0123456789ab"), true);
		for (const bad of [
			"",
			"L1",
			"../../etc",
			"6E9B6885-0A1B-4C2D-8E3F-0123456789AB",
			"6e9b6885-0a1b-4c2d-8e3f-0123456789ab/..",
			" 6e9b6885-0a1b-4c2d-8e3f-0123456789ab",
		]) {
			assert.equal(isLaunchId(bad), false, bad);
		}
	});

	it("el id sale del nombre de la carpeta del lanzamiento, o null si no es una", () => {
		assert.equal(
			launchIdOfDir("/tmp/x/figma-agent-6e9b6885-0a1b-4c2d-8e3f-0123456789ab"),
			"6e9b6885-0a1b-4c2d-8e3f-0123456789ab",
		);
		assert.equal(
			launchIdOfDir("/tmp/x/figma-agent-6e9b6885-0a1b-4c2d-8e3f-0123456789ab/"),
			"6e9b6885-0a1b-4c2d-8e3f-0123456789ab",
		);
		for (const bad of ["/tmp/x/otra", "/tmp/x/figma-agent-L1", ""]) {
			assert.equal(launchIdOfDir(bad), null, bad);
		}
	});
});
