// Comprobaciones puras de areas@1 que el esquema no ve: nombres repetidos, frames que no son del
// área y el cruce con screens@1. Cada problema sale con su puntero JSON.
import type { AreasFile, AreasIssue } from "./areas.ts";

export function areasIssues(
	file: AreasFile,
	screenKeys: readonly string[],
): AreasIssue[] {
	const issues: AreasIssue[] = [];
	const add = (pointer: string, message: string) =>
		issues.push({ pointer, message });
	const known = new Set(screenKeys);
	const frames = new Map<string, ReadonlySet<string>>();
	const seenAreas = new Set<string>();

	for (const [i, area] of file.areas.entries()) {
		if (seenAreas.has(area.name))
			add(`/areas/${i}/name`, `el área «${area.name}» está repetida`);
		seenAreas.add(area.name);

		const own = new Set<string>();
		for (const [j, screen] of area.screens.entries()) {
			if (own.has(screen.frame))
				add(
					`/areas/${i}/screens/${j}/frame`,
					`el frame «${screen.frame}» está repetido en «${area.name}»`,
				);
			own.add(screen.frame);
			if (screen.screen !== undefined && !known.has(screen.screen))
				add(
					`/areas/${i}/screens/${j}/screen`,
					`la pantalla «${screen.screen}» no está en screens@1`,
				);
			if (screen.shell !== undefined && area.shell === undefined)
				add(
					`/areas/${i}/screens/${j}/shell`,
					`la pantalla «${screen.frame}» pide una variante del shell pero «${area.name}» no declara \`shell\``,
				);
		}
		frames.set(area.name, own);

		const inArea = (pointer: string, frame: string) => {
			if (!own.has(frame))
				add(pointer, `«${frame}» no es un frame de «${area.name}»`);
		};
		for (const [k, link] of (area.links ?? []).entries()) {
			inArea(`/areas/${i}/links/${k}/from`, link.from);
			inArea(`/areas/${i}/links/${k}/to`, link.to);
		}
		if (area.flowStart !== undefined)
			inArea(`/areas/${i}/flowStart/frame`, area.flowStart.frame);
		for (const [k, fill] of (area.fills ?? []).entries())
			inArea(`/areas/${i}/fills/${k}/frame`, fill.frame);
	}

	for (const [s, group] of (file.shared ?? []).entries()) {
		for (const [f, from] of group.from.entries()) {
			const own = frames.get(from.area);
			if (own === undefined)
				add(`/shared/${s}/from/${f}/area`, `el área «${from.area}» no existe`);
			else if (!own.has(from.frame))
				add(
					`/shared/${s}/from/${f}/frame`,
					`«${from.frame}» no es un frame de «${from.area}»`,
				);
		}
	}
	return issues;
}
