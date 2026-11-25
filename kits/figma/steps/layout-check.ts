// kit/layout-check@1: revisión estructural de un área.
// Por cada frame de primer nivel de la página: textos que se pisan (caja de línea y glifos, recortados por los contenedores
// con recorte), contenedores colapsados y filas de tabla desalineadas. Solo lee.
import { startTracking } from "../core.ts";
import { descendantsOfType } from "../tree.ts";
import type { FrameNode, SceneNode, TextNode } from "../types.ts";
import { type AreaParams, requirePage } from "./common.ts";

type Box = { x: number; y: number; width: number; height: number };
type Item = { text: TextNode; bb: Box; rb: Box };

const overlap = (a: Box, b: Box): [number, number] => [
	Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
	Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
];

function intersect(a: Box, b: Box): Box {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return {
		x,
		y,
		width: Math.min(a.x + a.width, b.x + b.width) - x,
		height: Math.min(a.y + a.height, b.y + b.height) - y,
	};
}

// Los textos visibles con sus cajas, ya recortadas por los contenedores con recorte que los envuelven (el propio frame no recorta)
function collect(frame: FrameNode): Item[] {
	const items: Item[] = [];
	const walk = (node: SceneNode, clip: Box | null): void => {
		if (!node.visible || ("opacity" in node && node.opacity === 0)) return;
		if (node.type === "TEXT") {
			if (node.characters.trim() === "") return;
			const cut = (box: Box | null): Box | null => {
				if (box === null) return null;
				if (clip === null) return box;
				const r = intersect(box, clip);
				return r.width > 0 && r.height > 0 ? r : null;
			};
			const bb = cut(node.absoluteBoundingBox);
			const rb = cut(node.absoluteRenderBounds);
			if (bb !== null && rb !== null) items.push({ text: node, bb, rb });
			return;
		}
		if (!("children" in node)) return;
		let next = clip;
		if (node !== frame && "clipsContent" in node && node.clipsContent) {
			const box = node.absoluteBoundingBox;
			if (box !== null) {
				next = clip === null ? box : intersect(clip, box);
				if (next.width <= 0 || next.height <= 0) return;
			}
		}
		for (const child of node.children) walk(child, next);
	};
	walk(frame, null);
	return items;
}

const label = (item: Item): string => item.text.characters.trim().slice(0, 20);

function overlaps(items: Item[]): string[] {
	items.sort((a, b) => a.bb.y - b.bb.y);
	const bad: string[] = [];
	for (let i = 0; i < items.length; i++) {
		const a = items[i] as Item;
		for (
			let j = i + 1;
			j < items.length && (items[j] as Item).bb.y < a.bb.y + a.bb.height;
			j++
		) {
			const b = items[j] as Item;
			const [bx, by] = overlap(a.bb, b.bb);
			if (bx <= 2 || by <= 4) continue;
			const [rx, ry] = overlap(a.rb, b.rb);
			if (rx <= 0 || ry <= 0) continue;
			bad.push(`${label(a)} ✕ ${label(b)}`);
		}
	}
	return bad;
}

function collapsed(frame: FrameNode): number {
	return descendantsOfType(frame, ["FRAME", "INSTANCE"]).filter(
		(n) =>
			"children" in n && n.width <= 4 && n.children.some((k) => k.width > 40),
	).length;
}

function misalignedRows(
	frame: FrameNode,
	rowNames: string[],
	bodyNames: string[],
) {
	let count = 0;
	for (const body of descendantsOfType(frame, ["FRAME"])) {
		if (!bodyNames.includes(body.name) || !("children" in body)) continue;
		const rows = body.children.filter(
			(r) => rowNames.includes(r.name) && r.visible && "children" in r,
		);
		if (rows.length < 2) continue;
		const xsOf = (row: SceneNode): number[] =>
			"children" in row ? row.children.map((c) => Math.round(c.x)) : [];
		const ref = xsOf(rows[0] as SceneNode);
		for (const row of rows.slice(1)) {
			const xs = xsOf(row);
			if (
				xs.length !== ref.length ||
				xs.some((x, i) => Math.abs(x - (ref[i] as number)) > 1)
			)
				count += 1;
		}
	}
	return count;
}

export async function layoutCheck(params: AreaParams) {
	const area = params.area;
	const tracker = startTracking();
	const page = await requirePage(area);
	const { row, body } = params.linkRules.rows;
	const layout = [];
	for (const frame of page.children) {
		if (frame.type !== "FRAME") continue;
		const bad = overlaps(collect(frame));
		layout.push({
			area: area.name,
			frame: frame.name,
			frameId: frame.id,
			overlaps: bad.length,
			samples: bad.slice(0, 4),
			collapsed: collapsed(frame),
			misalignedRows: misalignedRows(frame, row, body),
		});
	}
	return tracker.done({ layout });
}
