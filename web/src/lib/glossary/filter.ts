import { foldQuery } from "#web/lib/chat/fold.ts";
import { GROUPS, type GroupId, type Term } from "#web/lib/glossary/terms.ts";

export type GlossaryFilter = {
	readonly query: string;
	readonly group: GroupId | null;
};
export type GlossaryGroup = {
	readonly id: GroupId;
	readonly title: string;
	readonly terms: readonly Term[];
};

// Sin mayúsculas ni acentos, en todo lo que se ve de un término (también su código)
const matches = (term: Term, needle: string): boolean =>
	[term.key, term.label, term.short, term.long ?? ""].some((text) =>
		foldQuery(text).includes(needle),
	);

// Los grupos que quedan con algún término, en el orden de GROUPS
export function filterGlossary(
	terms: readonly Term[],
	filter: GlossaryFilter,
): readonly GlossaryGroup[] {
	const needle = foldQuery(filter.query);
	return GROUPS.filter((g) => filter.group === null || g.id === filter.group)
		.map((g) => ({
			...g,
			terms: terms.filter((t) => t.group === g.id && matches(t, needle)),
		}))
		.filter((g) => g.terms.length > 0);
}
