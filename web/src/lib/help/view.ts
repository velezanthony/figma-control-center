import { GROUPS, type GroupId } from "#web/lib/glossary/terms.ts";
import { hrefOf, parseHash, ROUTE_NAME } from "#web/lib/route.ts";

export const HELP_TAB = Object.freeze({
	how: "how",
	glossary: "glossary",
} as const);
export type HelpTab = (typeof HELP_TAB)[keyof typeof HELP_TAB];

export type HelpView = {
	readonly tab: HelpTab;
	readonly group: GroupId | null;
};

// Parámetros de la vista de Ayuda. Van en el hash, así el `?project=` de la URL real se conserva
const PARAM = Object.freeze({ tab: "tab", group: "group" } as const);
// Los enlaces de antes llevaban el glosario en Inicio con uno de estos parámetros
const LEGACY_GLOSSARY_PARAMS = ["glossary", "glosario"] as const;

const groupOf = (value: string | null): GroupId | null =>
	GROUPS.find((g) => g.id === value)?.id ?? null;

export function parseHelpView(search: string): HelpView {
	const params = new URLSearchParams(search);
	const tab =
		params.get(PARAM.tab) === HELP_TAB.glossary
			? HELP_TAB.glossary
			: HELP_TAB.how;
	return { tab, group: groupOf(params.get(PARAM.group)) };
}

export function helpSearch(view: HelpView): string {
	const params = new URLSearchParams();
	if (view.tab !== HELP_TAB.how) params.set(PARAM.tab, view.tab);
	if (view.group !== null) params.set(PARAM.group, view.group);
	return params.toString();
}

export const glossaryHref = (group: GroupId): string =>
	hrefOf(ROUTE_NAME.help, helpSearch({ tab: HELP_TAB.glossary, group }));

// Un enlace guardado al glosario de Inicio (#/?glossary=tools) abre Ayuda → Glosario con su grupo; null si no lo es
export function legacyGlossaryHash(hash: string): string | null {
	const { route, search } = parseHash(hash);
	if (route !== ROUTE_NAME.home) return null;
	const params = new URLSearchParams(search);
	const legacy = LEGACY_GLOSSARY_PARAMS.find((name) => params.has(name));
	if (legacy === undefined) return null;
	const group = groupOf(params.get(legacy));
	return hrefOf(ROUTE_NAME.help, helpSearch({ tab: HELP_TAB.glossary, group }));
}
