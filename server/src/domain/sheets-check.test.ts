import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScreensFile } from "./capture.ts";
import { CONTRACT } from "./capture.ts";
import { SHEETS_CONTRACT, type Sheet, type SheetsFile } from "./sheets.ts";
import { sheetsIssues, sheetsWarnings } from "./sheets-check.ts";

const STYLE: SheetsFile["style"] = {
	header: { fill: "a", text: "b" },
	card: { fill: "c" },
	texts: { description: "d", bug: "e", tag: "f", rowLabel: "g", colLabel: "h" },
	matrix: { stroke: "i" },
};

const sheet = (key: string, extra: Partial<Sheet> = {}): Sheet => ({
	key,
	screen: `cmp-${key}`,
	title: key,
	page: { name: key },
	description: "d",
	...extra,
});

const file = (sheets: Sheet[]): SheetsFile => ({
	contract: SHEETS_CONTRACT,
	style: STYLE,
	sheets,
});

const screens = (
	keys: Record<string, readonly Record<string, string>[]>,
): ScreensFile => ({
	contract: CONTRACT.screens,
	screens: Object.entries(keys).map(([key, variants]) => ({
		key,
		title: key,
		url: "/x/",
		variants: variants.map((props) => ({ props })),
	})),
});

const pointers = (f: SheetsFile, s: ScreensFile) =>
	sheetsIssues(f, s).map((i) => i.pointer);

describe("sheetsIssues", () => {
	const ok = screens({
		"cmp-a": [{ size: "sm", state: "on" }],
		"cmp-b": [{ size: "sm" }],
	});

	it("un fichero coherente no da problemas", () => {
		assert.deepEqual(sheetsIssues(file([sheet("a"), sheet("b")]), ok), []);
	});

	it("`drift.map` con un valor para una prop que la web ya trae se señala (solo vale para las que únicamente tiene Figma)", () => {
		const fp = {
			variantProps: {},
			variants: [],
			properties: [],
			layers: [],
		};
		const map = (prop: string) =>
			sheet("a", {
				drift: { decision: "map", values: { [prop]: "no" }, fingerprint: fp },
			});
		const web = screens({ "cmp-a": [{ size: "sm" }] });
		assert.deepEqual(sheetsIssues(file([map("card")]), web), []);
		assert.deepEqual(
			sheetsIssues(file([map("size")]), web).map((i) => i.pointer),
			["/sheets/0/drift/values/size"],
		);
	});

	it("una clave de hoja repetida se señala en la segunda", () => {
		assert.deepEqual(pointers(file([sheet("a"), sheet("a")]), ok), [
			"/sheets/1/key",
		]);
	});

	it("una pantalla que no está en screens@1 se señala con el campo screen", () => {
		const f = file([sheet("a", { screen: "nada" })]);
		assert.deepEqual(pointers(f, ok), ["/sheets/0/screen"]);
	});

	it("matrix.rows con una prop que ninguna variante tiene se señala por posición", () => {
		const f = file([sheet("a", { matrix: { rows: ["size", "inventada"] } })]);
		assert.deepEqual(pointers(f, ok), ["/sheets/0/matrix/rows/1"]);
	});

	it("noBooleanWhen con una prop que ninguna variante tiene se señala por clave", () => {
		const f = file([
			sheet("a", {
				icons: [{ icon: "x", boolean: "B", noBooleanWhen: { fantasma: "1" } }],
			}),
		]);
		assert.deepEqual(pointers(f, ok), [
			"/sheets/0/icons/0/noBooleanWhen/fantasma",
		]);
	});

	it("con la pantalla desconocida no se pregunta por sus props (un solo problema)", () => {
		const f = file([sheet("a", { screen: "nada", matrix: { rows: ["z"] } })]);
		assert.deepEqual(pointers(f, ok), ["/sheets/0/screen"]);
	});

	it("un nombre de propiedad repetido entre textos, booleanos, iconos y huecos se señala en el segundo", () => {
		const f = file([
			sheet("a", {
				texts: [{ name: "Etiqueta", match: "x" }],
				booleans: [{ name: "Etiqueta", layer: "c" }],
				icons: [{ icon: "i", boolean: "Mostrar", swap: "Icono" }],
				slots: [{ name: "Icono", layer: "h" }],
			}),
		]);
		assert.deepEqual(pointers(f, ok), [
			"/sheets/0/booleans/0/name",
			"/sheets/0/slots/0/name",
		]);
	});

	it("dos iconos pueden compartir el mismo booleano o el mismo intercambio", () => {
		const f = file([
			sheet("a", {
				icons: [
					{ icon: "i", boolean: "Mostrar", swap: "Icono" },
					{ icon: "j", boolean: "Mostrar", swap: "Icono" },
				],
			}),
		]);
		assert.deepEqual(sheetsIssues(f, ok), []);
	});
});

describe("sheetsWarnings: lo que es aviso y no error", () => {
	it("una regla que recognize.js no nombra es un aviso con su puntero", () => {
		const f = file([sheet("a", { rules: ["Button", "Fantasma"] })]);
		const w = sheetsWarnings(f, { recognizeSource: "set: 'Button'" });
		assert.deepEqual(
			w.map((x) => x.pointer),
			["/sheets/0/rules/1"],
		);
	});

	it("sin recognize no se juzgan las reglas", () => {
		const f = file([sheet("a", { rules: ["Fantasma"] })]);
		assert.deepEqual(sheetsWarnings(f, { recognizeSource: null }), []);
	});
});
