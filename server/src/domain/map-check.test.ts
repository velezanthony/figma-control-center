import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapExample } from "../../test/contracts/map.ts";
import { fingerprintIssues, mapIssues } from "./map-check.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON de prueba que se edita campo a campo
type Loose = any;
const example = (): Loose => structuredClone(mapExample());

describe("mapIssues", () => {
	it("el ejemplo no tiene problemas", () => {
		assert.deepEqual(mapIssues(example()), []);
	});

	it("una expresión que no compila sale con su puntero", () => {
		const bad = example();
		bad.tokens.classToVariable[0].from = "(";
		const [issue] = mapIssues(bad);
		assert.equal(issue?.pointer, "/tokens/classToVariable/0/from");
		assert.match(issue?.message ?? "", /no compila/);
	});

	it("una expresión de más de 200 caracteres sale aunque compile", () => {
		const bad = example();
		bad.fonts.families[0].match = "a".repeat(201);
		const [issue] = mapIssues(bad);
		assert.equal(issue?.pointer, "/fonts/families/0/match");
		assert.match(issue?.message ?? "", /200/);
	});

	it("revisa también los efectos, la página de iconos y los glifos", () => {
		const bad = example();
		bad.effects = { classPattern: "[" };
		bad.icons.pages = "(";
		bad.icons.glyphs = { classPattern: "?", prefix: "g/" };
		assert.deepEqual(
			mapIssues(bad).map((i) => i.pointer),
			["/effects/classPattern", "/icons/pages", "/icons/glyphs/classPattern"],
		);
	});

	it("las clases genéricas son expresiones: la que no compila sale con su puntero", () => {
		const bad = example();
		bad.components = {
			fingerprints: "fp.json",
			leaf: [],
			genericClasses: ["flex", "(", "a".repeat(201)],
		};
		assert.deepEqual(
			mapIssues(bad).map((i) => i.pointer),
			["/components/genericClasses/1", "/components/genericClasses/2"],
		);
	});
});

describe("fingerprintIssues", () => {
	const fp = (title: string) => ({ title, tag: "div", cls: [] });
	const map = (leaf: string[]) => {
		const m = example();
		m.components = { fingerprints: "fp.json", leaf, genericClasses: [] };
		return m;
	};

	it("sin `components` no hay nada que comprobar", () => {
		assert.deepEqual(fingerprintIssues(example(), {}), []);
	});

	it("un componente de `leaf` que no está en las huellas sale con su puntero", () => {
		const issues = fingerprintIssues(map(["a", "falta", "b"]), {
			a: fp("A"),
			b: fp("B"),
		});
		assert.deepEqual(
			issues.map((i) => i.pointer),
			["/components/leaf/1"],
		);
		assert.match(issues[0]?.message ?? "", /falta/);
	});

	it("si todos están, no hay problemas", () => {
		assert.deepEqual(fingerprintIssues(map(["a"]), { a: fp("A") }), []);
	});

	it("`screens` con reglas se acepta sin cruzar con nada: son nombres de reglas del módulo del proyecto", () => {
		const m = map([]);
		m.screens = { inicio: { rules: ["Button"] } };
		assert.deepEqual(fingerprintIssues(m, {}), []);
	});
});
