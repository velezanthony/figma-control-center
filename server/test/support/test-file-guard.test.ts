import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertTestingFile,
	figmaFileKey,
	requireTestFile,
} from "./test-file-guard.ts";

const TESTING_URL = "https://www.figma.com/design/ABC123/pruebas";

describe("guarda del archivo de pruebas", () => {
	it("extrae el fileKey de una URL de diseño, con o sin parámetros", () => {
		assert.equal(
			figmaFileKey("https://www.figma.com/design/ABC123/Nombre?node-id=1-2"),
			"ABC123",
		);
		assert.equal(figmaFileKey("https://www.figma.com/file/XYZ/Nombre"), "XYZ");
	});

	it("una URL que no es de Figma no tiene fileKey", () => {
		assert.equal(figmaFileKey("https://example.com/design/ABC/Nombre"), null);
		assert.equal(figmaFileKey("https://www.figma.com/"), null);
	});

	it("acepta el archivo configurado, con o sin parámetros y con otro nombre", () => {
		assert.doesNotThrow(() => assertTestingFile(TESTING_URL, TESTING_URL));
		assert.doesNotThrow(() =>
			assertTestingFile(`${TESTING_URL}?node-id=0-1`, TESTING_URL),
		);
		assert.doesNotThrow(() =>
			assertTestingFile(
				"https://www.figma.com/design/ABC123/otro",
				TESTING_URL,
			),
		);
	});

	it("rechaza cualquier otro archivo, con el motivo", () => {
		assert.throws(
			() =>
				assertTestingFile(
					"https://www.figma.com/design/OTRO/Trabajo",
					TESTING_URL,
				),
			/no es el archivo de pruebas/,
		);
		assert.throws(
			() => assertTestingFile(null, TESTING_URL),
			/no es el archivo de pruebas/,
		);
	});

	it("rechaza la ausencia de URL (sin FIGMA_TEST_FILE_URL no se toca Figma)", () => {
		assert.throws(() => requireTestFile(null), /FIGMA_TEST_FILE_URL/);
	});

	it("rechaza una URL configurada que no es de un archivo de Figma", () => {
		assert.throws(
			() => requireTestFile("https://example.com/design/ABC/x"),
			/no es una URL de archivo de Figma/,
		);
		assert.equal(requireTestFile(TESTING_URL), TESTING_URL);
	});
});
