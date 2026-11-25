// El kit empaquetado que lee el servidor (kits/dist/capture-kit.js) corresponde a sus fuentes, y el capturador de serie
// solo compone piezas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
	bundleCaptureKit,
	CAPTURE_KIT_BUNDLE,
	REPO_ROOT,
} from "../../build.ts";

describe("kit de captura: empaquetado y composición", () => {
	it("el empaquetado versionado es el que sale de las fuentes (si no: npm run build:kit)", async () => {
		assert.equal(
			readFileSync(CAPTURE_KIT_BUNDLE, "utf8"),
			await bundleCaptureKit(),
			"kits/dist/capture-kit.js no corresponde a kits/capture: regenéralo con «npm run build:kit»",
		);
	});

	it("el capturador de serie no lee estilos ni cajas ni pinta: eso lo hacen las piezas", () => {
		const source = readFileSync(
			resolve(REPO_ROOT, "kits/capture/capturer.ts"),
			"utf8",
		);
		for (const call of [
			"getComputedStyle",
			"getBoundingClientRect",
			"toDataURL",
			"drawImage",
		])
			assert.equal(source.includes(call), false, call);
	});
});
