import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { figmaFileUrlProblem } from "./figma-url.ts";

describe("figmaFileUrlProblem: la regla de URL de un archivo de Figma", () => {
	for (const url of [
		"https://www.figma.com/design/abc123",
		"https://www.figma.com/design/abc123/Nombre-del-archivo",
		"https://www.figma.com/file/abc123/Nombre",
		"https://www.figma.com/file/abc123",
	]) {
		it(`acepta ${url}`, () => {
			assert.equal(figmaFileUrlProblem(url), null);
		});
	}

	for (const [what, url, hint] of [
		["sin clave", "https://www.figma.com/design/", /clave|archivo de Figma/],
		[
			"sin clave y sin barra",
			"https://www.figma.com/design",
			/archivo de Figma/,
		],
		["otro dominio", "https://example.com/design/abc123/N", /archivo de Figma/],
		["http", "http://www.figma.com/design/abc123/N", /archivo de Figma/],
		[
			"otra sección",
			"https://www.figma.com/community/file/abc123",
			/archivo de Figma/,
		],
		[
			"query",
			"https://www.figma.com/design/abc123/N?node-id=1-2",
			/query string/,
		],
		["fragmento", "https://www.figma.com/design/abc123/N#x", /fragmento/],
		["no es URL", "figma", /URL/],
	] as const) {
		it(`rechaza ${what}`, () => {
			const problem = figmaFileUrlProblem(url);
			assert.ok(problem !== null);
			assert.match(problem, hint);
		});
	}
});
