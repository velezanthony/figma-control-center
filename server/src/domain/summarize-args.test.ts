import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_ARG_CHARS, summarizeToolArgs } from "./summarize-args.ts";

describe("summarizeToolArgs", () => {
	it("una ruta de script se registra tal cual, junto al resto de escalares", () => {
		assert.deepEqual(
			summarizeToolArgs({ file: "scripts/a.js", format: "body", n: 2 }, 20),
			{ file: "scripts/a.js", format: "body", n: 2 },
		);
	});

	it("los steps de un lote guardan el número de pasos y el primer fichero, no la lista", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{ steps: [{ file: "a.js", format: "body" }, { file: "b.js" }] },
				20,
			),
			{ stepCount: 2, firstFile: "a.js" },
		);
		assert.deepEqual(summarizeToolArgs({ steps: [] }, 20), { stepCount: 0 });
	});

	it("un paso del kit en `steps` cuenta como paso y su etiqueta es el primero", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{ steps: [{ use: "kit/place@1", area: "Panel" }, { file: "b.js" }] },
				20,
			),
			{ stepCount: 2, firstFile: "kit/place@1 · Panel" },
		);
	});

	it("un build-screen en `steps` se resume por su pantalla", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{
					steps: [{ use: "kit/build-screen@1", screen: "home", area: "Panel" }],
				},
				20,
			),
			{ stepCount: 1, firstFile: "kit/build-screen@1 · home" },
		);
	});

	it("un compose en `steps` se resume por su clave", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{ steps: [{ use: "kit/compose@1", compose: "alta-formulario" }] },
				20,
			),
			{ stepCount: 1, firstFile: "kit/compose@1 · alta-formulario" },
		);
	});

	it("las áreas de un figma_build guardan cuántas son y la primera", () => {
		assert.deepEqual(
			summarizeToolArgs({ areas: ["Panel", "Portada"], stopOnError: true }, 20),
			{ areaCount: 2, firstArea: "Panel", stopOnError: true },
		);
	});

	it("las hojas de un figma_build guardan cuántas son y la primera", () => {
		assert.deepEqual(
			summarizeToolArgs({ sheets: ["button", "badge"], stopOnError: true }, 20),
			{ sheetCount: 2, firstSheet: "button", stopOnError: true },
		);
	});

	it("un code largo se reduce a longitud y vista previa, nunca entero (CA-2)", () => {
		const code = "x".repeat(5_000_000);
		const summary = summarizeToolArgs({ code }, 10);
		assert.deepEqual(summary, {
			codeLength: 5_000_000,
			codePreview: "x".repeat(10),
		});
		assert.ok(JSON.stringify(summary).length < 100);
	});

	it("un code más corto que la vista previa se guarda completo", () => {
		assert.deepEqual(summarizeToolArgs({ code: "return 1" }, 50), {
			codeLength: 8,
			codePreview: "return 1",
		});
	});

	it("una vista previa de 0 caracteres guarda solo la longitud", () => {
		assert.deepEqual(summarizeToolArgs({ code: "abc" }, 0), {
			codeLength: 3,
			codePreview: "",
		});
	});

	it("un texto largo que no es code se recorta", () => {
		const summary = summarizeToolArgs({ note: "y".repeat(10_000) }, 10);
		const note = summary["note"];
		assert.equal(typeof note, "string");
		assert.ok(String(note).length <= MAX_ARG_CHARS + 1);
	});

	it("objetos, arrays y valores ausentes no se registran", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{
					data: { big: 1 },
					list: [1, 2],
					gone: undefined,
					flag: false,
					nada: null,
				},
				10,
			),
			{ flag: false, nada: null },
		);
	});

	it("las listas de nodeIds y pages guardan cuántos son y el primero, como los steps", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{ nodeIds: ["10:1", "10:3"], format: "PNG", pages: ["A", "B", "C"] },
				10,
			),
			{
				nodeIdCount: 2,
				firstNodeId: "10:1",
				format: "PNG",
				pageCount: 3,
				firstPage: "A",
			},
		);
	});

	it("la lista de pantallas de figma_capture guarda cuántas son y la primera", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{ screens: ["inicio", "panel"], allowPageWorld: true },
				10,
			),
			{ screenCount: 2, firstScreen: "inicio", allowPageWorld: true },
		);
	});

	it("figma_design_context: la variante pedida se guarda como texto `prop=opción`, y el resto de argumentos como siempre", () => {
		assert.deepEqual(
			summarizeToolArgs(
				{
					nodeId: "10:1",
					maxNodes: 50,
					screenshot: false,
					variant: { Tamaño: "M", Tipo: "Primario" },
				},
				10,
			),
			{
				nodeId: "10:1",
				maxNodes: 50,
				screenshot: false,
				variant: "Tamaño=M, Tipo=Primario",
			},
		);
	});

	it("un objeto que no es la variante sigue sin guardarse", () => {
		assert.deepEqual(summarizeToolArgs({ params: { a: 1 } }, 10), {});
	});
});
