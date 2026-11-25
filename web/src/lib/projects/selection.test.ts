import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	activeIdAfterLoad,
	type ProjectOption,
	parseProjectList,
	resolveActiveId,
} from "./selection.ts";

const OPTIONS: ProjectOption[] = [
	{ id: "default", name: "Por defecto" },
	{ id: "ejemplo", name: "Ejemplo" },
	{ id: "cliente", name: "Cliente" },
];

describe("resolveActiveId", () => {
	it("la URL manda si el proyecto existe", () => {
		assert.equal(resolveActiveId(OPTIONS, "ejemplo", "cliente"), "ejemplo");
	});

	it("si la URL no vale, usa el de localStorage", () => {
		assert.equal(resolveActiveId(OPTIONS, "no-existe", "cliente"), "cliente");
		assert.equal(resolveActiveId(OPTIONS, null, "cliente"), "cliente");
	});

	it("si ni URL ni localStorage valen, el primero disponible", () => {
		assert.equal(resolveActiveId(OPTIONS, "x", "y"), "default");
		assert.equal(resolveActiveId(OPTIONS, null, null), "default");
	});

	it("sin proyectos, ninguno", () => {
		assert.equal(resolveActiveId([], "ejemplo", "cliente"), null);
	});
});

describe("parseProjectList", () => {
	const entry = {
		id: "a",
		name: "A",
		projectDir: "/a",
		fileUrl: "https://www.figma.com/design/a/A",
	};

	it("una respuesta buena trae las filas y los problemas", () => {
		const list = parseProjectList(true, {
			ok: true,
			entries: [entry],
			problems: ["x"],
		});
		assert.deepEqual(list, { entries: [entry], problems: ["x"] });
	});

	it("sin problemas en el cuerpo, la lista de problemas está vacía", () => {
		assert.deepEqual(
			parseProjectList(true, { entries: [entry] })?.problems,
			[],
		);
	});

	it("un error HTTP, un cuerpo con ok:false o sin filas es una carga fallida (null), no una lista vacía", () => {
		assert.equal(parseProjectList(false, { entries: [entry] }), null);
		assert.equal(parseProjectList(true, { ok: false, entries: [] }), null);
		assert.equal(parseProjectList(true, {}), null);
		assert.equal(parseProjectList(true, null), null);
	});
});

describe("activeIdAfterLoad", () => {
	const list = {
		entries: [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		],
		problems: [],
	};

	it("con la lista cargada resuelve como siempre", () => {
		assert.equal(activeIdAfterLoad(list, "a", "b", null), "b");
		assert.equal(activeIdAfterLoad(list, "a", "x", null), "a");
	});

	it("si la carga falla no cambia la selección: se queda con la actual", () => {
		assert.equal(activeIdAfterLoad(null, "b", "b", null), "b");
		assert.equal(activeIdAfterLoad(null, "b", null, "a"), "b");
	});
});
