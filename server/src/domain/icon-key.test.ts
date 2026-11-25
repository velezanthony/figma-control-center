import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { iconKey } from "./icon-key.ts";

const ICONS = resolve(
	import.meta.dirname,
	"../../test/fixtures/parity/icons.json",
);

describe("iconKey", () => {
	it("une los trazados con «|» en el orden en que salen", () => {
		assert.equal(
			iconKey('<svg><path d="M1 1"/><path stroke="x" d="M2 2L3 3"/></svg>'),
			"M1 1|M2 2L3 3",
		);
	});

	it("un svg sin trazados da la clave vacía", () => {
		assert.equal(iconKey("<svg></svg>"), "");
	});

	it("no confunde atributos que acaban en d (id, fill-rule) con un trazado", () => {
		assert.equal(iconKey('<svg><g id="a"><path d="M0 0"/></g></svg>'), "M0 0");
	});

	// La regla (re.findall(r'\sd="([^"]+)"') y "|".join): el resultado de Python sobre un catálogo de referencia,
	// calculado una vez con python3
	it("da las mismas claves que la regla de referencia en Python sobre el catálogo congelado", () => {
		const icons = JSON.parse(readFileSync(ICONS, "utf8")) as {
			name: string;
			svg: string;
		}[];
		const keys = new Map(icons.map((i) => [iconKey(i.svg), i.name]));
		assert.equal(icons.length, 57);
		assert.equal(keys.size, 56);
		assert.equal(
			keys.get("M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"),
			"arrow-right",
		);
		assert.equal(
			keys.get(
				"M2.25 6 9 12.75l4.286-4.286a11.948 11.948 0 0 1 4.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181",
			),
			"arrow-trending-down",
		);
	});
});
