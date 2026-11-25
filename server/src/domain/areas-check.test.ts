import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREAS_CONTRACT, type AreasFile } from "./areas.ts";
import { areasIssues } from "./areas-check.ts";

const RULES: AreasFile["linkRules"] = {
	clickable: { names: ["boton"], namePrefixes: [], components: [] },
	rows: { row: ["fila"], body: ["cuerpo"] },
	transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
};

const area = (
	name: string,
	extra: Partial<AreasFile["areas"][number]> = {},
): AreasFile["areas"][number] => ({
	name,
	page: name,
	frame: { width: 100, minHeight: 100 },
	place: {
		mode: "replace-content",
		source: { pagePrefix: "t ", take: "first-frame" },
	},
	screens: [{ frame: "a" }, { frame: "b" }],
	...extra,
});

const file = (
	areas: AreasFile["areas"],
	shared?: AreasFile["shared"],
): AreasFile => ({
	contract: AREAS_CONTRACT,
	linkRules: RULES,
	areas,
	...(shared !== undefined && { shared }),
});

const pointers = (f: AreasFile, keys: readonly string[] = ["x"]) =>
	areasIssues(f, keys).map((i) => i.pointer);

describe("areasIssues: comprobaciones que el esquema no ve", () => {
	it("un fichero coherente no da problemas", () => {
		assert.deepEqual(
			areasIssues(
				file(
					[
						area("Uno", {
							screens: [{ frame: "a", screen: "x" }, { frame: "b" }],
							links: [{ from: "a", text: "Ir", to: "b" }],
							flowStart: { frame: "a", name: "Uno" },
							fills: [
								{
									frame: "b",
									find: { text: "Mapa", minSize: [1, 1] },
									asset: "m.png",
								},
							],
						}),
					],
					[
						{
							name: "G",
							set: "G / Set",
							page: { name: "Compartido" },
							part: ["p"],
							variantProp: "area",
							from: [{ area: "Uno", frame: "a", value: "uno" }],
						},
					],
				),
				["x"],
			),
			[],
		);
	});

	it("un área repetida señala el nombre de la segunda", () => {
		assert.deepEqual(pointers(file([area("Uno"), area("Uno")])), [
			"/areas/1/name",
		]);
	});

	it("un frame repetido dentro de un área señala el segundo", () => {
		assert.deepEqual(
			pointers(
				file([area("Uno", { screens: [{ frame: "a" }, { frame: "a" }] })]),
			),
			["/areas/0/screens/1/frame"],
		);
	});

	it("un enlace a un frame que no es del área señala `from` o `to`", () => {
		const links = [
			{ from: "z", text: "Ir", to: "b" },
			{ from: "a", rows: true as const, to: "y" },
		];
		assert.deepEqual(pointers(file([area("Uno", { links })])), [
			"/areas/0/links/0/from",
			"/areas/0/links/1/to",
		]);
	});

	it("flowStart y fills con un frame que no es del área se señalan", () => {
		assert.deepEqual(
			pointers(
				file([
					area("Uno", {
						flowStart: { frame: "z", name: "Uno" },
						fills: [
							{
								frame: "q",
								find: { text: "T", minSize: [1, 1] },
								asset: "a.png",
							},
						],
					}),
				]),
			),
			["/areas/0/flowStart/frame", "/areas/0/fills/0/frame"],
		);
	});

	it("una entrada de `shared` con área o frame que no existen se señala", () => {
		const g = (area: string, frame: string): AreasFile["shared"] => [
			{
				name: "G",
				set: "S",
				page: { name: "P" },
				part: ["p"],
				variantProp: "v",
				from: [{ area, frame, value: "x" }],
			},
		];
		assert.deepEqual(pointers(file([area("Uno")], g("Otra", "a"))), [
			"/shared/0/from/0/area",
		]);
		assert.deepEqual(pointers(file([area("Uno")], g("Uno", "z"))), [
			"/shared/0/from/0/frame",
		]);
	});

	it("una `screen` que no está en screens@1 se señala (cruce)", () => {
		assert.deepEqual(
			pointers(
				file([area("Uno", { screens: [{ frame: "a", screen: "no" }] })]),
			),
			["/areas/0/screens/0/screen"],
		);
	});

	it("un `shell` de pantalla sin `shell` en el área se señala", () => {
		assert.deepEqual(
			pointers(file([area("Uno", { screens: [{ frame: "a", shell: "v" }] })])),
			["/areas/0/screens/0/shell"],
		);
	});

	it("los problemas salen todos, en orden, cada uno con su mensaje", () => {
		const issues = areasIssues(
			file([
				area("Uno", { screens: [{ frame: "a", screen: "no", shell: "v" }] }),
			]),
			["x"],
		);
		assert.equal(issues.length, 2);
		assert.ok(issues.every((i) => i.message.length > 0));
	});
});
