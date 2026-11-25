import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	glossaryHref,
	HELP_TAB,
	helpSearch,
	legacyGlossaryHash,
	parseHelpView,
} from "./view.ts";

describe("vista de Ayuda en la URL", () => {
	it("sin parámetros abre «Cómo funciona» sin grupo", () => {
		assert.deepEqual(parseHelpView(""), { tab: HELP_TAB.how, group: null });
	});

	it("lee la pestaña y el grupo; un grupo o una pestaña que no existen se ignoran", () => {
		assert.deepEqual(parseHelpView("tab=glossary&group=tools"), {
			tab: HELP_TAB.glossary,
			group: "tools",
		});
		assert.deepEqual(parseHelpView("tab=nada&group=nada"), {
			tab: HELP_TAB.how,
			group: null,
		});
	});

	it("serializa solo lo que no es el valor por defecto", () => {
		assert.equal(helpSearch({ tab: HELP_TAB.how, group: null }), "");
		assert.equal(
			helpSearch({ tab: HELP_TAB.glossary, group: null }),
			"tab=glossary",
		);
		assert.equal(
			helpSearch({ tab: HELP_TAB.glossary, group: "errors" }),
			"tab=glossary&group=errors",
		);
	});
});

describe("enlace a un grupo del glosario", () => {
	it("abre Ayuda → Glosario con el grupo elegido, sin tocar el ?project= de la URL", () => {
		assert.equal(glossaryHref("tools"), "#/help?tab=glossary&group=tools");
	});

	it("los enlaces antiguos al glosario de Inicio se reescriben a Ayuda con su grupo", () => {
		assert.equal(
			legacyGlossaryHash("#/?glossary=tools"),
			"#/help?tab=glossary&group=tools",
		);
		assert.equal(
			legacyGlossaryHash("#/?x=1&glosario=errors"),
			"#/help?tab=glossary&group=errors",
		);
		assert.equal(legacyGlossaryHash("#/?glossary=nada"), "#/help?tab=glossary");
	});

	it("un Inicio sin glosario u otra pantalla con ese parámetro no se tocan", () => {
		assert.equal(legacyGlossaryHash("#/"), null);
		assert.equal(legacyGlossaryHash(""), null);
		assert.equal(legacyGlossaryHash("#/activity?glossary=tools"), null);
	});
});
