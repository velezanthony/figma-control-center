// kit/links@1: los enlaces del prototipo de un área, su punto de inicio y el recorte.
import { note, startTracking } from "../core.ts";
import { startFlow } from "../flow.ts";
import { byText, linkTo, rows } from "../links.ts";
import type { FrameNode } from "../types.ts";
import {
	type AreaParams,
	findAreaFrame,
	notFound,
	requirePage,
} from "./common.ts";

export async function links(params: AreaParams) {
	const area = params.area;
	const tracker = startTracking();
	const page = await requirePage(area);

	// Todo lo que se nombra existe antes de escribir: si falta algo, no se ha tocado nada
	const wanted = new Set<string>();
	for (const link of area.links ?? []) {
		if (link.from === link.to) continue;
		wanted.add(link.from);
		wanted.add(link.to);
	}
	if (area.flowStart !== undefined) wanted.add(area.flowStart.frame);
	const frames = new Map<string, FrameNode>();
	const missing: string[] = [];
	for (const name of wanted) {
		const frame = await findAreaFrame(area, page, name);
		if (frame === null)
			missing.push(`el frame «${name}» de la página «${area.page}»`);
		else frames.set(name, frame);
	}
	if (missing.length > 0) notFound(missing);

	const clickable = area.clickable ?? params.linkRules.clickable;
	const report: {
		area: string;
		from: string;
		text?: string;
		rows?: true;
		to: string;
		count: number;
		unchanged: number;
	}[] = [];
	for (const link of area.links ?? []) {
		if (link.from === link.to) continue;
		const from = frames.get(link.from) as FrameNode;
		const to = frames.get(link.to) as FrameNode;
		const nodes =
			"rows" in link
				? rows(from, params.linkRules.rows)
				: await byText(from, link.text, {
						match: link.match,
						clickable,
						skipInside: area.shell?.set,
					});
		let unchanged = 0;
		for (const node of nodes) {
			const done = await linkTo(node, to, {
				transition: params.linkRules.transition,
			});
			if (!done.changed) unchanged += 1;
		}
		const label = "rows" in link ? "filas" : link.text;
		if (nodes.length === 0) {
			note.warn("LINK_ZERO", `${link.from}: ${label} → ${link.to} ×0`);
		}
		report.push({
			area: area.name,
			from: link.from,
			...("rows" in link ? { rows: true as const } : { text: link.text }),
			to: link.to,
			count: nodes.length,
			unchanged,
		});
	}

	if (area.flowStart !== undefined) {
		startFlow(
			page,
			frames.get(area.flowStart.frame) as FrameNode,
			area.flowStart.name,
		);
	}
	if (area.frame.clip === true) {
		for (const screen of area.screens) {
			const frame =
				frames.get(screen.frame) ??
				(await findAreaFrame(area, page, screen.frame));
			if (frame === null) continue;
			if (frame.clipsContent) continue;
			frame.clipsContent = true;
			note.mutated(frame);
		}
	}
	return tracker.done({ links: report });
}
