// sheet/flow-icons.ts: los iconos absolutos de un input (pl-9 / pr-9) pasan a
// ir en línea con el texto, y ocultarlos libera su hueco como en el código.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanNode } from "../../../../../kits/figma/screen/types.ts";
import { flowIcons } from "../../../../../kits/figma/sheet/flow-icons.ts";

const node = (o: Partial<PlanNode>): PlanNode => ({
	id: "i",
	path: "0",
	t: "frame",
	w: 10,
	h: 10,
	...o,
});

function field(): PlanNode {
	const input = node({
		tag: "input",
		x: 0,
		y: 0,
		w: 200,
		h: 36,
		pad: [8, 12, 8, 36],
		kids: [node({ t: "text", txt: "Buscar", w: 60 })],
	});
	const leading = node({
		pos: "absolute",
		x: 10,
		y: 8,
		kids: [node({ t: "svg", x: 2, y: 2, w: 16, h: 16 })],
	});
	return node({ tag: "div", w: 200, h: 36, kids: [input, leading] });
}

describe("flowIcons", () => {
	it("un icono absoluto dentro del input pasa a ser su primer hijo y el relleno izquierdo se ajusta", () => {
		const root = field();
		flowIcons(root);
		const input = (root.kids ?? [])[0] as PlanNode;
		assert.equal(root.kids?.length, 1);
		assert.equal(input.kids?.[0]?.t, "svg");
		assert.equal(input.kids?.[0]?.pos, "static");
		assert.equal(input.kids?.[0]?.noPos, true);
		assert.equal(input.pad?.[3], 12);
		assert.equal(input.disp, "flex");
		assert.equal(input.dir, "row");
		assert.equal(input.ai, "center");
		assert.equal(input.gap, 8);
	});

	it("un icono a la derecha pasa a ser el último hijo y ajusta el relleno derecho", () => {
		const root = field();
		const [input, holder] = root.kids as [PlanNode, PlanNode];
		holder.x = 170;
		input.pad = [8, 36, 8, 12];
		flowIcons(root);
		const moved = (root.kids ?? [])[0] as PlanNode;
		assert.equal(moved.kids?.at(-1)?.t, "svg");
		assert.equal(moved.pad?.[1], 12);
		assert.equal(moved.gap, 8);
	});

	it("sin input no hace nada, y un icono fuera del input se queda", () => {
		const plain = node({ tag: "div", kids: [node({ tag: "span" })] });
		flowIcons(plain);
		assert.equal(plain.kids?.length, 1);
		const root = field();
		(root.kids?.[1] as PlanNode).x = 500;
		flowIcons(root);
		assert.equal(root.kids?.length, 2);
	});

	it("recorre los hijos antes que el nodo (un input dentro de un contenedor)", () => {
		const wrapper = node({ tag: "section", kids: [field()] });
		flowIcons(wrapper);
		const inner = wrapper.kids?.[0] as PlanNode;
		assert.equal(inner.kids?.length, 1);
	});
});
