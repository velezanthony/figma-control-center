// El cliente de la vigilancia que abre agent-run.ts contra el panel, frente al panel FALSO en un puerto libre.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LOOPBACK } from "../../../test/harness/env.ts";
import {
	type FakePanel,
	startFakePanel,
} from "../../../test/harness/fake-panel.ts";
import { freePort, until } from "../../../test/harness/wait.ts";
import { watchPanel } from "./panel-watch.ts";

const LAUNCH = "6e9b6885-0a1b-4c2d-8e3f-0123456789ab";

let panel: FakePanel;
beforeEach(async () => {
	panel = await startFakePanel();
});
afterEach(() => panel.stop());

// Lo que el cliente avisa, en orden
function track(port = panel.port) {
	const seen: string[] = [];
	const watch = watchPanel(
		{ host: LOOPBACK, port, launchId: LAUNCH },
		{
			onConnected: () => seen.push("connected"),
			onLost: () => seen.push("lost"),
			onClose: () => seen.push("close"),
		},
	);
	return { seen, watch };
}

describe("watchPanel", () => {
	it("abre GET /api/agent/watch?launch=<id> con JSON y sin cuerpo, y avisa una vez de que está conectado", async () => {
		const { seen, watch } = track();
		await until("conecta", () => seen.length > 0);
		assert.deepEqual(seen, ["connected"]);
		assert.equal(panel.open(), 1);
		const [req] = panel.requests;
		assert.equal(req?.method, "GET");
		assert.equal(req?.url, `/api/agent/watch?launch=${LAUNCH}`);
		assert.equal(req?.headers["content-type"], "application/json");
		assert.equal(req?.headers["host"], `${LOOPBACK}:${panel.port}`);
		assert.equal(req?.headers["content-length"], undefined);
		assert.equal(req?.headers["transfer-encoding"], undefined);
		watch.cancel();
	});

	it("si el panel muere, avisa una vez de que se perdió", async () => {
		const { seen } = track();
		await until("conecta", () => seen.length > 0);
		await panel.die();
		await until("se pierde", () => seen.length > 1);
		assert.deepEqual(seen, ["connected", "lost"]);
	});

	it("el evento close del panel se avisa como close, no como pérdida", async () => {
		const { seen } = track();
		await until("conecta", () => seen.length > 0);
		assert.equal(panel.sendClose(LAUNCH), 1);
		await until("llega el close", () => seen.length > 1);
		await new Promise((r) => setTimeout(r, 50));
		assert.deepEqual(seen, ["connected", "close"]);
	});

	it("un panel que no reconoce el lanzamiento (404) cuenta como perdido, sin conectar", async () => {
		panel.known = new Set();
		const { seen } = track();
		await until("responde", () => seen.length > 0);
		assert.deepEqual(seen, ["lost"]);
	});

	it("sin panel escuchando (conexión rechazada) cuenta como perdido", async () => {
		const { seen } = track(await freePort());
		await until("falla", () => seen.length > 0);
		assert.deepEqual(seen, ["lost"]);
	});

	it("cancelar suelta la conexión y no avisa de nada más", async () => {
		const { seen, watch } = track();
		await until("conecta", () => seen.length > 0);
		watch.cancel();
		await until("el panel ve que se soltó", () => panel.open() === 0);
		await panel.die();
		await new Promise((r) => setTimeout(r, 50));
		assert.deepEqual(seen, ["connected"]);
	});
});
