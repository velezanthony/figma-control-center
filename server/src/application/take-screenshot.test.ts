import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIGMA_ERROR_TYPE, scriptError } from "#domain/figma-error.ts";
import { err, ok } from "#domain/result.ts";
import { makeTakeScreenshot } from "./take-screenshot.ts";
import { InMemoryFigmaGateway } from "./testing/in-memory-figma-gateway.ts";
import { InMemoryResultStore } from "./testing/in-memory-ports.ts";

describe("makeTakeScreenshot", () => {
	it("guarda el PNG y devuelve ruta y dimensiones", async () => {
		const gateway = new InMemoryFigmaGateway();
		const store = new InMemoryResultStore();
		gateway.screenshotReply = ok({
			png: Uint8Array.from([1, 2, 3]),
			width: 40,
			height: 20,
		});
		const at = new Date(2026, 10, 9, 21, 31, 4);
		const r = await makeTakeScreenshot({ gateway, store, now: () => at })(
			"1:2",
			2,
		);
		assert.deepEqual(r, {
			ok: true,
			value: {
				path: "/salida/screenshots/2026-11-09/1-2_213104.png",
				bytes: 3,
				width: 40,
				height: 20,
			},
		});
		assert.deepEqual(gateway.screenshotCalls, [{ nodeId: "1:2", scale: 2 }]);
		assert.deepEqual(store.pngNames, [{ nodeId: "1:2", at }]);
	});

	it("si Figma falla no guarda nada y propaga el error", async () => {
		const gateway = new InMemoryFigmaGateway();
		const store = new InMemoryResultStore();
		gateway.screenshotReply = err(
			scriptError("Nodo no encontrado", null, false),
		);
		const r = await makeTakeScreenshot({
			gateway,
			store,
			now: () => new Date(),
		})("9:9", 1);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.equal(store.png.length, 0);
	});
});
