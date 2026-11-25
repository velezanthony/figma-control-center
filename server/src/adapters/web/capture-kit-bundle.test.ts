import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCaptureKitBundle } from "./capture-kit-bundle.ts";

describe("readCaptureKitBundle", () => {
	it("lee el empaquetado versionado con la versión del kit de captura", () => {
		const kit = readCaptureKitBundle();
		assert.equal(kit.version, "capture-kit@1");
		assert.match(kit.content, /__figmaCaptureKit/);
	});

	it("un empaquetado que no está lanza: quien lo pide lo trata como un fallo del registro", () => {
		assert.throws(() => readCaptureKitBundle("/no/existe/capture-kit.js"));
	});
});
