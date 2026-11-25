import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { refHref, refLabel } from "./ref-links.ts";

const FILE = "https://www.figma.com/design/ABC123/Mi-archivo?node-id=0-1";
const CALL = "3f9d5c00-aaaa-4bbb-8ccc-0123456789ab";

describe("refHref: adónde lleva un id citado en una respuesta", () => {
	it("un nodo abre Figma en ese nodo (el id «1234:5678» viaja como «1234-5678»)", () => {
		assert.equal(
			refHref({ t: "node", id: "1234:5678" }, FILE),
			"https://www.figma.com/design/ABC123/Mi-archivo?node-id=1234-5678",
		);
	});

	it("sin archivo de Figma conocido el nodo no es un enlace", () => {
		assert.equal(refHref({ t: "node", id: "1:2" }, null), null);
	});

	it("una llamada abre su detalle en Actividad, también sin archivo de Figma", () => {
		assert.equal(
			refHref({ t: "call", id: CALL }, null),
			`#/activity?open=${CALL}`,
		);
	});
});

describe("refLabel", () => {
	it("el nodo se muestra entero y la llamada abreviada (el id completo va en el tooltip)", () => {
		assert.equal(refLabel({ t: "node", id: "1234:5678" }), "1234:5678");
		assert.equal(refLabel({ t: "call", id: CALL }), "3f9d5c00");
	});
});
