import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	COMPONENT_TYPE,
	componentsSummary,
	exportSummary,
	instancesSummary,
	STYLE_KIND,
	type StyleEntry,
	stylesSummary,
	type VariableCollection,
	variablesSummary,
} from "./catalog.ts";

const collection = (
	name: string,
	modes: number,
	variables: number,
): VariableCollection => ({
	id: `C:${name}`,
	name,
	modes: Array.from({ length: modes }, (_, i) => ({
		id: `m${i}`,
		name: `M${i}`,
	})),
	defaultModeId: "m0",
	variables: Array.from({ length: variables }, (_, i) => ({
		id: `V:${name}:${i}`,
		name: `v${i}`,
		resolvedType: "FLOAT",
		scopes: [],
		description: "",
		valuesByMode: {},
	})),
});

const style = (kind: StyleEntry["kind"]): StyleEntry => ({
	id: "S:1,",
	key: "1",
	name: "s",
	kind,
	description: "",
	boundVariables: {},
	value: [],
});

describe("resumen de una lectura: conteos pequeños, nunca la lista", () => {
	it("variables: colecciones, variables y modos por colección", () => {
		assert.deepEqual(
			variablesSummary({
				collections: [
					collection("Primitives", 1, 3),
					collection("Tokens", 2, 5),
				],
			}),
			{
				collections: 2,
				variables: { Primitives: 3, Tokens: 5 },
				modes: { Primitives: 1, Tokens: 2 },
			},
		);
	});

	it("variables de un nodo: suma los enlaces encontrados", () => {
		assert.deepEqual(
			variablesSummary({
				collections: [collection("Tokens", 2, 1)],
				bindings: [
					{ nodeId: "1:2", field: "fills", variableId: "V:Tokens:0" },
					{ nodeId: "1:3", field: "fills", variableId: "V:Tokens:0" },
				],
			}),
			{
				collections: 1,
				variables: { Tokens: 1 },
				modes: { Tokens: 2 },
				bindings: 2,
			},
		);
	});

	it("estilos: cuántos hay de cada tipo, también los que no hay", () => {
		assert.deepEqual(
			stylesSummary([
				style(STYLE_KIND.paint),
				style(STYLE_KIND.paint),
				style(STYLE_KIND.text),
			]),
			{ paint: 2, text: 1, effect: 0, grid: 0 },
		);
	});

	it("componentes: sets, componentes sueltos y páginas distintas", () => {
		const base = {
			key: "k",
			description: "",
			variants: {},
			properties: [],
			variantCount: 0,
		};
		assert.deepEqual(
			componentsSummary([
				{
					...base,
					id: "1:1",
					name: "Botón",
					type: COMPONENT_TYPE.set,
					page: "A",
					pageIndex: 0,
				},
				{
					...base,
					id: "1:2",
					name: "Icono",
					type: COMPONENT_TYPE.component,
					page: "A",
					pageIndex: 0,
				},
				{
					...base,
					id: "2:1",
					name: "Tarjeta",
					type: COMPONENT_TYPE.component,
					page: "B",
					pageIndex: 1,
				},
			]),
			{ sets: 1, components: 2, pages: 2 },
		);
	});

	it("instancias: frames y total de instancias contadas", () => {
		assert.deepEqual(
			instancesSummary([
				{
					page: "P",
					frameId: "1:1",
					frameName: "A",
					counts: { Botón: 3, Icono: 1 },
				},
				{ page: "P", frameId: "1:2", frameName: "B", counts: {} },
			]),
			{ frames: 2, instances: 4 },
		);
	});

	it("exportación: ficheros y bytes en total", () => {
		assert.deepEqual(
			exportSummary([
				{ nodeId: "1:1", path: "/a.png", bytes: 10 },
				{ nodeId: "1:2", path: "/b.png", bytes: 5 },
			]),
			{ files: 2, bytes: 15 },
		);
	});
});
