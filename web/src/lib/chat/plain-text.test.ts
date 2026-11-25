import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { plainTextOf } from "./plain-text.ts";

describe("plainTextOf: el texto que se ve de un mensaje, sin la sintaxis de Markdown", () => {
	it("quita énfasis, títulos y viñetas pero conserva las palabras", () => {
		const text = plainTextOf(
			"## Resumen\n\nHubo **12 llamadas** y *1 error*:\n\n- uno\n- dos",
		);
		assert.doesNotMatch(text, /[#*]/);
		assert.match(text, /Resumen/);
		assert.match(text, /Hubo 12 llamadas y 1 error/);
		assert.match(text, /uno/);
		assert.match(text, /dos/);
	});

	it("un enlace aporta su texto, no su dirección", () => {
		const text = plainTextOf(
			"mira [la documentación](https://example.com/secreto)",
		);
		assert.match(text, /la documentación/);
		assert.doesNotMatch(text, /example\.com|secreto/);
	});

	it("el código en línea y los bloques de código aportan su contenido", () => {
		assert.match(
			plainTextOf("usa `setSharedPluginData` aquí"),
			/setSharedPluginData/,
		);
		assert.match(plainTextOf("```js\nconst a = 1;\n```"), /const a = 1;/);
	});

	it("las celdas de una tabla aportan su texto, una por línea de fila", () => {
		const text = plainTextOf(
			"| Herramienta | Llamadas |\n|---|--:|\n| figma_run_script | 8 |",
		);
		assert.match(text, /Herramienta/);
		assert.match(text, /figma_run_script/);
	});

	it("un id de llamada se busca por lo que se ve (la forma abreviada), no por el UUID entero", () => {
		const text = plainTextOf("falló `3f9d5c00-aaaa-4bbb-8ccc-0123456789ab`");
		assert.match(text, /3f9d5c00/);
		assert.doesNotMatch(text, /aaaa-4bbb/);
	});

	it("el HTML en bruto es texto, igual que se pinta", () => {
		assert.match(plainTextOf("<b>hola</b>"), /<b>hola<\/b>/);
	});

	it("un texto vacío da cadena vacía", () => {
		assert.equal(plainTextOf(""), "");
	});
});
