// El formulario de Proyectos (web/) no puede importar el dominio en tiempo de ejecución, así que repite la regla de
// URL de Figma. Este test las ata: lo que el formulario deja pasar, el servidor lo acepta, y al revés.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { figmaFileUrlProblem } from "#domain/figma-url.ts";
import { validateForm } from "../../web/src/lib/projects/form.ts";

const URLS = [
	"https://www.figma.com/design/abc123",
	"https://www.figma.com/design/abc123/Nombre",
	"https://www.figma.com/file/abc123/Nombre",
	"https://www.figma.com/design/",
	"https://www.figma.com/design",
	"https://www.figma.com/file/",
	"https://www.figma.com/design//Nombre",
	"https://www.figma.com/design/abc123/N?node-id=1-2",
	"https://www.figma.com/design/abc123/N#x",
	"http://www.figma.com/design/abc123/N",
	"https://figma.com/design/abc123/N",
	"https://example.com/design/abc123/N",
	"https://www.figma.com/community/file/abc123",
	"figma",
];

describe("la URL del formulario y la del servidor son la misma regla", () => {
	for (const fileUrl of URLS) {
		it(fileUrl, () => {
			const form = {
				name: "n",
				projectDir: "/p",
				fileUrl,
				scriptsRoots: "",
				outputDir: "",
			};
			const formAccepts = validateForm(form) === null;
			const serverAccepts = figmaFileUrlProblem(fileUrl) === null;
			assert.equal(formAccepts, serverAccepts);
		});
	}
});
