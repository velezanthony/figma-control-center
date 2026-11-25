// flowIcons: los iconos absolutos de un input (pl-9 / pr-9) pasan a ir en línea con el texto, y ocultarlos
// libera su hueco como en el código. Muta los nodos del plan antes de pintar.
import type { PlanNode } from "../screen/types.ts";

export function flowIcons(n: PlanNode): void {
	for (const k of n.kids ?? []) flowIcons(k);
	const kids = n.kids ?? [];
	const inp = kids.find((k) => k.tag === "input");
	if (inp === undefined) return;
	const svgOf = (h: PlanNode) => (h.kids ?? []).find((c) => c.t === "svg");
	const inside = (h: PlanNode): boolean => {
		const sv = svgOf(h);
		if (sv === undefined) return false;
		const ix = (h.x as number) + (sv.x as number);
		return ix >= (inp.x as number) && ix + sv.w <= (inp.x as number) + inp.w;
	};
	const holders = kids.filter(
		(k) =>
			k.pos === "absolute" &&
			(k.kids ?? []).some((c) => c.t === "svg") &&
			inside(k),
	);
	if (holders.length === 0) return;
	const text = (inp.kids ?? []).find((k) => k.t === "text");
	if (text !== undefined) text.grow = true;
	const pad = inp.pad ?? [0, 0, 0, 0];
	inp.pad = pad;
	inp.kids = inp.kids ?? [];
	let gap = 0;
	for (const h of holders) {
		const sv = svgOf(h) as PlanNode;
		const ix = (h.x as number) + (sv.x as number);
		sv.pos = "static";
		sv.noPos = true;
		const left = ix < (inp.x as number) + inp.w / 2;
		if (left) {
			gap = Math.max(gap, (inp.x as number) + (pad[3] as number) - (ix + sv.w));
			pad[3] = ix - (inp.x as number);
			inp.kids.unshift(sv);
		} else {
			gap = Math.max(
				gap,
				ix - ((inp.x as number) + inp.w - (pad[1] as number)),
			);
			pad[1] = (inp.x as number) + inp.w - (ix + sv.w);
			inp.kids.push(sv);
		}
	}
	n.kids = kids.filter((k) => !holders.includes(k));
	Object.assign(inp, {
		disp: "flex",
		dir: "row",
		ai: "center",
		jc: "normal",
		gap: Math.round(gap),
	});
}
