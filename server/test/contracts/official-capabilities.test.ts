// Contratos del diseño a código y del diseño sin web: design-context@1 y compose@1, y los campos nuevos `compose` de project@1 y
// `source` de cada hoja de sheets@1. Casos válidos e inválidos.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComposeSchema } from "#adapters/contracts/compose.ts";
import { DesignContextSchema } from "#adapters/contracts/design-context.ts";
import { ProjectSchema } from "#adapters/contracts/project.ts";
import { SheetsSchema } from "#adapters/contracts/sheets.ts";
import { projectExample } from "./capture.ts";
import { COMPOSE_CONTRACT_SOURCES, composeExample } from "./compose.ts";
import {
	DESIGN_CONTEXT_CONTRACT_SOURCES,
	designContextExample,
} from "./design-context.ts";
import { sheetsExample } from "./sheets.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON de prueba que se edita campo a campo
type Loose = any;

describe("contrato design-context@1", () => {
	const context = () => structuredClone(designContextExample()) as Loose;
	const valid = (value: unknown) =>
		DesignContextSchema.safeParse(value).success;

	it("cita su fuente", () => {
		assert.ok(
			DESIGN_CONTEXT_CONTRACT_SOURCES.some((s) =>
				s.includes("docs/users/contracts.md"),
			),
		);
	});

	it("el ejemplo cumple con todos sus campos opcionales", () => {
		assert.equal(valid(context()), true);
	});

	it("una clave de más en cualquier nivel no cumple", () => {
		for (const edit of [
			(c: Loose) => (c.extra = 1),
			(c: Loose) => (c.file.extra = 1),
			(c: Loose) => (c.origin.extra = 1),
			(c: Loose) => (c.nodes[0].extra = 1),
			(c: Loose) => (c.nodes[0].layout.extra = 1),
			(c: Loose) => (c.nodes[1].text.font.extra = 1),
			(c: Loose) => (c.nodes[2].instance.extra = 1),
			(c: Loose) => (c.components["k-boton"].code.extra = 1),
			(c: Loose) => (c.truncated.extra = 1),
		]) {
			const c = context();
			edit(c);
			assert.equal(valid(c), false);
		}
	});

	it("R-2: el origen admite `area`, `screen`, `sheet` y `compose`, y nada más", () => {
		for (const kind of ["area", "screen", "sheet", "compose"]) {
			const c = context();
			c.origin.kind = kind;
			assert.equal(valid(c), true, kind);
		}
		const c = context();
		c.origin.kind = "page";
		assert.equal(valid(c), false);
		delete c.origin;
		assert.equal(valid(c), true);
	});

	it("R-1: `code.by` es `key` o `name`, y es obligatorio", () => {
		for (const by of ["key", "name"]) {
			const c = context();
			c.components["k-boton"].code.by = by;
			assert.equal(valid(c), true, by);
		}
		const bad = context();
		bad.components["k-boton"].code.by = "huella";
		assert.equal(valid(bad), false);
		const missing = context();
		delete missing.components["k-boton"].code.by;
		assert.equal(valid(missing), false);
	});

	it("un componente sin `code` puede traer candidatas; el `source` no puede estar vacío", () => {
		const c = context();
		assert.deepEqual(c.components["k-tarjeta"].candidates, [
			"card",
			"card-compact",
		]);
		c.components["k-boton"].code.source = "";
		assert.equal(valid(c), false);
	});

	it("un valor es `raw`, `variable` o `style`, nunca dos a la vez ni ninguno", () => {
		for (const value of [
			{ raw: 4 },
			{ raw: "mixed" },
			{ raw: [1, 2] },
			{ raw: { type: "SOLID" } },
			{ variable: "VariableID:1:1" },
			{ style: "S:titulo," },
		]) {
			const c = context();
			c.nodes[0].fills = [value];
			assert.equal(valid(c), true, JSON.stringify(value));
		}
		for (const value of [
			{},
			{ raw: 1, variable: "v" },
			{ variable: "v", style: "s" },
			{ variable: 3 },
			{ raw: null },
		]) {
			const c = context();
			c.nodes[0].fills = [value];
			assert.equal(valid(c), false, JSON.stringify(value));
		}
	});

	it("el relleno interno son cuatro valores (arriba, derecha, abajo, izquierda)", () => {
		const c = context();
		c.nodes[0].layout.padding = c.nodes[0].layout.padding.slice(0, 3);
		assert.equal(valid(c), false);
	});

	it("el modo de maquetación y el ajuste de tamaño son de lista cerrada", () => {
		const mode = context();
		mode.nodes[0].layout.mode = "NONE";
		assert.equal(valid(mode), false);
		const sizing = context();
		sizing.nodes[0].placement.sizing.h = "AUTO";
		assert.equal(valid(sizing), false);
	});

	it("la raíz no tiene padre (null) y el resto sí: el campo es obligatorio", () => {
		const c = context();
		delete c.nodes[1].parent;
		assert.equal(valid(c), false);
	});

	it("el contrato, el motivo del recorte y el código del aviso son literales", () => {
		const contract = context();
		contract.contract = "design-context@2";
		assert.equal(valid(contract), false);
		const reason = context();
		reason.truncated.reason = "bytes";
		assert.equal(valid(reason), false);
		const warning = context();
		warning.warnings[0].code = "INVENTADO";
		assert.equal(valid(warning), false);
	});

	it("el tipo de un estilo es paint, text, effect o grid", () => {
		const c = context();
		c.styles["S:titulo,"].kind = "fill";
		assert.equal(valid(c), false);
	});
});

describe("contrato compose@1", () => {
	const compose = () => structuredClone(composeExample()) as Loose;
	const valid = (value: unknown) => ComposeSchema.safeParse(value).success;

	it("cita su fuente", () => {
		assert.ok(
			COMPOSE_CONTRACT_SOURCES.some((s) =>
				s.includes("docs/users/contracts.md"),
			),
		);
	});

	it("el ejemplo cumple con un bloque de cada clase", () => {
		assert.equal(valid(compose()), true);
	});

	it("una clave de más, en el fichero o en un bloque, no cumple", () => {
		for (const edit of [
			(c: Loose) => (c.extra = 1),
			(c: Loose) => (c.target.extra = 1),
			(c: Loose) => (c.root.extra = 1),
			(c: Loose) => (c.root.children[0].extra = 1),
			(c: Loose) => (c.root.children[1].extra = 1),
			(c: Loose) => (c.root.children[2].extra = 1),
			(c: Loose) => (c.root.children[3].extra = 1),
		]) {
			const c = compose();
			edit(c);
			assert.equal(valid(c), false);
		}
	});

	it("un bloque es de una sola clase: dos a la vez o ninguna no cumple", () => {
		for (const block of [
			{},
			{ text: "x", style: "s", use: "boton" },
			{ stack: "VERTICAL", children: [], icon: "check" },
			{ name: "solo nombre" },
		]) {
			const c = compose();
			c.root.children.push(block);
			assert.equal(valid(c), false, JSON.stringify(block));
		}
	});

	it("la dirección del apilado es VERTICAL, HORIZONTAL o GRID", () => {
		for (const stack of ["VERTICAL", "HORIZONTAL", "GRID"]) {
			const c = compose();
			c.root.stack = stack;
			assert.equal(valid(c), true, stack);
		}
		const c = compose();
		c.root.stack = "NONE";
		assert.equal(valid(c), false);
	});

	it("`padding` es un token o una lista de tokens; nunca un número", () => {
		const one = compose();
		one.root.padding = "spacing/4";
		assert.equal(valid(one), true);
		for (const padding of [4, [4], [], [""]]) {
			const c = compose();
			c.root.padding = padding;
			assert.equal(valid(c), false, JSON.stringify(padding));
		}
	});

	it("`gap`, `fill`, `radius` y `color` son tokens (texto): un número no cumple", () => {
		for (const edit of [
			(c: Loose) => (c.root.gap = 8),
			(c: Loose) => (c.root.fill = 255),
			(c: Loose) => (c.root.radius = 4),
			(c: Loose) => (c.root.children[0].color = 0),
		]) {
			const c = compose();
			edit(c);
			assert.equal(valid(c), false);
		}
	});

	it("`use` es la clave de una hoja o `{ key }`; las props son texto o booleano", () => {
		const props = compose();
		props.root.children[1].props = { cantidad: 3 };
		assert.equal(valid(props), false);
		const use = compose();
		use.root.children[1].use = 3;
		assert.equal(valid(use), false);
		const empty = compose();
		empty.root.children[1].use = "";
		assert.equal(valid(empty), false);
	});

	it("los huecos (`slots`) llevan bloques, también anidados", () => {
		const c = compose();
		c.root.children[1].slots = {
			ayuda: [{ stack: "VERTICAL", children: [{ icon: "check" }] }],
		};
		assert.equal(valid(c), true);
		c.root.children[1].slots = { ayuda: [{ icono: "check" }] };
		assert.equal(valid(c), false);
	});

	it("el destino pide página y ancho; el alto y el frame son opcionales", () => {
		for (const key of ["page", "width"]) {
			const c = compose();
			delete c.target[key];
			assert.equal(valid(c), false, key);
		}
		const c = compose();
		delete c.target.height;
		delete c.target.frame;
		assert.equal(valid(c), true);
		c.target.width = 0;
		assert.equal(valid(c), false);
	});

	it("el contrato es literal y la clave del compose no lleva barras ni espacios", () => {
		const contract = compose();
		contract.contract = "compose@2";
		assert.equal(valid(contract), false);
		for (const key of ["", "con espacio", "a/b", "a.b"]) {
			const c = compose();
			c.key = key;
			assert.equal(valid(c), false, key);
		}
	});

	it("`fit` de una imagen es de lista cerrada", () => {
		const c = compose();
		c.root.children[3].fit = "estirar";
		assert.equal(valid(c), false);
	});
});

describe("project@1 y sheets@1: los campos `compose` y `source`", () => {
	it("project@1 admite `compose` (una ruta) y rechaza que no sea texto o esté vacío", () => {
		const p = structuredClone(projectExample()) as Loose;
		p.compose = "compose/";
		assert.equal(ProjectSchema.safeParse(p).success, true);
		for (const bad of [3, "", null]) {
			p.compose = bad;
			assert.equal(ProjectSchema.safeParse(p).success, false, String(bad));
		}
	});

	it("sheets@1 admite `source` en una hoja y rechaza que no sea texto o esté vacío", () => {
		const f = structuredClone(sheetsExample()) as Loose;
		f.sheets[0].source = "src/components/button.html";
		assert.equal(SheetsSchema.safeParse(f).success, true);
		for (const bad of [3, "", null]) {
			f.sheets[0].source = bad;
			assert.equal(SheetsSchema.safeParse(f).success, false, String(bad));
		}
	});
});
