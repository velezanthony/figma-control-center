import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	confirmationStands,
	emptyForm,
	formOf,
	needsScriptsConfirm,
	type ProjectForm,
	scriptsRootsKey,
	toEntryInput,
	validateForm,
} from "./form.ts";

const valid: ProjectForm = {
	name: "Mi proyecto",
	projectDir: "/p/mi-proyecto",
	fileUrl: "https://www.figma.com/design/abc/Nombre",
	scriptsRoots: "",
	outputDir: "",
};

describe("validateForm", () => {
	it("la URL de Figma exige la clave del archivo", () => {
		for (const fileUrl of [
			"https://www.figma.com/design/",
			"https://www.figma.com/file/",
			"https://www.figma.com/design",
			"https://www.figma.com/design//Nombre",
		]) {
			const problem = validateForm({ ...valid, fileUrl });
			assert.equal(problem?.field, "fileUrl", fileUrl);
		}
	});

	it("acepta un formulario completo", () => {
		assert.equal(validateForm(valid), null);
	});

	it("exige nombre, directorio y URL", () => {
		assert.match(validateForm({ ...valid, name: "" })?.message ?? "", /nombre/);
		assert.match(
			validateForm({ ...valid, projectDir: "" })?.message ?? "",
			/directorio/,
		);
		assert.match(validateForm({ ...valid, fileUrl: "" })?.message ?? "", /URL/);
	});

	it("dice en qué campo falla", () => {
		assert.equal(validateForm({ ...valid, name: "" })?.field, "name");
		assert.equal(
			validateForm({ ...valid, projectDir: "" })?.field,
			"projectDir",
		);
		assert.equal(validateForm({ ...valid, fileUrl: "" })?.field, "fileUrl");
	});

	it("rechaza una URL con query o fragmento", () => {
		assert.match(
			validateForm({ ...valid, fileUrl: `${valid.fileUrl}?node-id=1` })
				?.message ?? "",
			/query/,
		);
	});

	it("rechaza una URL que no es un archivo de Figma", () => {
		assert.match(
			validateForm({ ...valid, fileUrl: "https://example.com/design/abc/X" })
				?.message ?? "",
			/Figma/,
		);
	});

	it("acepta el formato antiguo /file/ de Figma", () => {
		assert.equal(
			validateForm({
				...valid,
				fileUrl: "https://www.figma.com/file/abc/Nombre",
			}),
			null,
		);
	});
});

describe("needsScriptsConfirm", () => {
	it("solo si hay alguna raíz de scripts", () => {
		assert.equal(needsScriptsConfirm(valid), false);
		assert.equal(
			needsScriptsConfirm({ ...valid, scriptsRoots: "  \n " }),
			false,
		);
		assert.equal(needsScriptsConfirm({ ...valid, scriptsRoots: "/s" }), true);
	});
});

describe("la confirmación de la raíz de scripts", () => {
	const form = { ...valid, scriptsRoots: "/s/uno\n/s/dos" };

	it("la clave ignora espacios y líneas vacías", () => {
		assert.equal(
			scriptsRootsKey({ ...form, scriptsRoots: "  /s/uno \n\n/s/dos\n" }),
			scriptsRootsKey(form),
		);
	});

	it("una confirmación pedida sobre las mismas raíces sigue en pie", () => {
		assert.equal(confirmationStands(form, scriptsRootsKey(form)), true);
	});

	it("si se edita la raíz después de pedirla, hay que volver a confirmar", () => {
		const pending = scriptsRootsKey(form);
		assert.equal(
			confirmationStands({ ...form, scriptsRoots: "/s/otra" }, pending),
			false,
		);
		assert.equal(
			confirmationStands({ ...form, scriptsRoots: "" }, pending),
			false,
		);
	});

	it("sin confirmación pedida no hay nada en pie", () => {
		assert.equal(confirmationStands(form, null), false);
	});
});

describe("toEntryInput", () => {
	it("omite los opcionales vacíos y no incluye id", () => {
		assert.deepEqual(toEntryInput(valid), {
			name: "Mi proyecto",
			projectDir: "/p/mi-proyecto",
			fileUrl: "https://www.figma.com/design/abc/Nombre",
		});
	});

	it("parte scriptsRoots por líneas y recorta", () => {
		const e = toEntryInput({
			...valid,
			scriptsRoots: " scripts \n\n /tmp/x \n",
			outputDir: "out",
		});
		assert.deepEqual(e.scriptsRoots, ["scripts", "/tmp/x"]);
		assert.equal(e.outputDir, "out");
	});
});

describe("emptyForm / formOf", () => {
	it("ida y vuelta de una fila con opcionales (el id no viaja en el formulario)", () => {
		const form = formOf({
			name: "X",
			projectDir: "/x",
			fileUrl: "https://www.figma.com/design/x/X",
			scriptsRoots: ["a", "b"],
			outputDir: "o",
		});
		assert.equal(form.scriptsRoots, "a\nb");
		assert.deepEqual(toEntryInput(form), {
			name: "X",
			projectDir: "/x",
			fileUrl: "https://www.figma.com/design/x/X",
			scriptsRoots: ["a", "b"],
			outputDir: "o",
		});
	});

	it("el formulario no tiene Base SQLite: la base es una sola y no se elige por proyecto", () => {
		assert.deepEqual(Object.keys(emptyForm()).sort(), [
			"fileUrl",
			"name",
			"outputDir",
			"projectDir",
			"scriptsRoots",
		]);
	});

	it("emptyForm está vacío", () => {
		assert.equal(
			validateForm(emptyForm())?.message,
			"El nombre es obligatorio.",
		);
	});
});
