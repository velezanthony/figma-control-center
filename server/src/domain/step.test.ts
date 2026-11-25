import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	declaresStep,
	FIGMA_KIT,
	isKitStep,
	KIT_STEPS,
	kitStepCode,
	kitStepLabel,
	STEP_CONTRACT,
	STEP_HEADER,
} from "./step.ts";

describe("cabecera de step@1", () => {
	it("la constante del kit y la del contrato son las mismas", () => {
		assert.equal(FIGMA_KIT, "figma-kit@1");
		assert.equal(STEP_CONTRACT, "step@1");
		assert.equal(STEP_HEADER, "// @contract step@1");
	});

	it("la primera línea con la cabecera y su descripción juzga el resultado", () => {
		assert.equal(
			declaresStep("// @contract step@1 · crea el icono\nreturn {};"),
			true,
		);
	});

	it("vale sin descripción, con espacios delante y con BOM", () => {
		assert.equal(declaresStep("// @contract step@1\nreturn {};"), true);
		assert.equal(declaresStep("  // @contract step@1 · x"), true);
		assert.equal(declaresStep("﻿// @contract step@1 · x"), true);
		assert.equal(declaresStep("// @contract step@1\r\nreturn {};"), true);
	});

	it("sin cabecera no se juzga: ni en otra línea, ni otra versión, ni otro contrato, ni pegada a más texto", () => {
		assert.equal(declaresStep("return {};"), false);
		assert.equal(declaresStep("\n// @contract step@1 · x"), false);
		assert.equal(declaresStep("const a = 1;\n// @contract step@1 · x"), false);
		assert.equal(declaresStep("// @contract step@2 · x"), false);
		assert.equal(declaresStep("// @contract step@10 · x"), false);
		assert.equal(declaresStep("// @contract capture@1 · x"), false);
		assert.equal(declaresStep(""), false);
	});
});

describe("pasos del kit", () => {
	it("son los cinco de área (F3 y la maquetación de F5), el de F4, el de las hojas y el de compose, con versión", () => {
		assert.deepEqual(
			[...KIT_STEPS],
			[
				"kit/place@1",
				"kit/share@1",
				"kit/links@1",
				"kit/fill-image@1",
				"kit/layout-check@1",
				"kit/build-screen@1",
				"kit/build-component@1",
				"kit/compose@1",
			],
		);
		assert.equal(isKitStep("kit/place@1"), true);
		assert.equal(isKitStep("kit/place@2"), false);
		assert.equal(isKitStep("kit/layout-check@1"), true);
		assert.equal(isKitStep("kit/layout-check@2"), false);
	});

	it("el código fijo de cada paso lleva la cabecera de step@1 y llama a su pieza del kit", () => {
		assert.equal(
			kitStepCode("kit/fill-image@1"),
			"// @contract step@1 · kit/fill-image@1\nreturn await kit.steps.fillImage(params, assets);",
		);
		for (const step of KIT_STEPS) {
			assert.equal(declaresStep(kitStepCode(step)), true);
		}
		assert.equal(
			kitStepCode("kit/layout-check@1"),
			"// @contract step@1 · kit/layout-check@1\nreturn await kit.steps.layoutCheck(params, assets);",
		);
		assert.match(
			kitStepCode("kit/place@1"),
			/kit\.steps\.place\(params, assets\)/,
		);
		assert.equal(
			kitStepCode("kit/build-screen@1"),
			"// @contract step@1 · kit/build-screen@1\nconst recognize = null;\nreturn await kit.steps.buildScreen(params, assets, recognize);",
		);
	});

	it("`build-screen` lleva el módulo recognize@1 del proyecto dentro del código, tal cual, tras `const recognize =`; los demás pasos no cambian", () => {
		const source = '{ contract: "recognize@1", rules: {} }';
		const code = kitStepCode("kit/build-screen@1", { recognize: source });
		assert.equal(
			code,
			`// @contract step@1 · kit/build-screen@1\nconst recognize =\n${source}\n;\nreturn await kit.steps.buildScreen(params, assets, recognize);`,
		);
		assert.equal(declaresStep(code), true);
		assert.equal(
			kitStepCode("kit/place@1", { recognize: source }),
			kitStepCode("kit/place@1"),
		);
	});

	it("el módulo va en sus propias líneas: un comentario final no se come lo que sigue", () => {
		const code = kitStepCode("kit/build-screen@1", {
			recognize: "  { a: 1 } // fin\n\n",
		});
		assert.match(code, /const recognize =\n\{ a: 1 \} \/\/ fin\n;\nreturn/);
	});

	it("la etiqueta de un paso es el paso y su objetivo: el área, o la pantalla en `build-screen`", () => {
		assert.equal(kitStepLabel("kit/place@1", "Panel"), "kit/place@1 · Panel");
		assert.equal(
			kitStepLabel("kit/build-screen@1", "home"),
			"kit/build-screen@1 · home",
		);
	});
});

describe("kit/build-component@1", () => {
	it("llama a su pieza con el módulo recognize@1 igual que build-screen, o con null", () => {
		assert.equal(
			kitStepCode("kit/build-component@1"),
			"// @contract step@1 · kit/build-component@1\nconst recognize = null;\nreturn await kit.steps.buildComponent(params, assets, recognize);",
		);
		const code = kitStepCode("kit/build-component@1", {
			recognize: "{ a: 1 }",
		});
		assert.match(code, /const recognize =\n\{ a: 1 \}\n;/);
		assert.equal(declaresStep(code), true);
	});

	it("su etiqueta lleva la clave de la hoja", () => {
		assert.equal(
			kitStepLabel("kit/build-component@1", "button"),
			"kit/build-component@1 · button",
		);
	});
});

describe("kit/compose@1", () => {
	it("llama a su pieza sin recognize: lo que pinta son datos de compose@1, no una captura", () => {
		assert.equal(
			kitStepCode("kit/compose@1"),
			"// @contract step@1 · kit/compose@1\nreturn await kit.steps.compose(params, assets);",
		);
		assert.equal(declaresStep(kitStepCode("kit/compose@1")), true);
	});

	it("su etiqueta lleva la clave del compose", () => {
		assert.equal(
			kitStepLabel("kit/compose@1", "alta-formulario"),
			"kit/compose@1 · alta-formulario",
		);
	});
});
