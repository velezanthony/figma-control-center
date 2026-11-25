import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ATTEMPT_COLUMNS } from "#web/lib/attempts/columns.ts";
import { termOf } from "#web/lib/glossary/terms.ts";

describe("las columnas de la lista de objetivos", () => {
	it("la ayuda de «Último estado» explica la columna, no uno de sus valores", () => {
		const status = ATTEMPT_COLUMNS.find((c) => c.id === "status");
		assert.ok(status?.term, "la columna lleva ayuda");
		const term = termOf(status.term);
		assert.equal(term?.label, "Último estado");
		assert.match(term?.short ?? "", /último intento/);
	});
});
