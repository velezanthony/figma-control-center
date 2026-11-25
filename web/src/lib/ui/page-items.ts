export const GAP = "gap" as const;
export type PageItem = number | typeof GAP;

// Primera, última, la actual y sus vecinas; un hueco de una sola página se rellena
export function pageItems(page: number, pageCount: number): PageItem[] {
	const keep = new Set<number>(
		[1, pageCount, page - 1, page, page + 1].filter(
			(n) => n >= 1 && n <= pageCount,
		),
	);
	const sorted = [...keep].sort((a, b) => a - b);
	const items: PageItem[] = [];
	let previous = 0;
	for (const n of sorted) {
		if (n - previous === 2) items.push(previous + 1);
		else if (n - previous > 2) items.push(GAP);
		items.push(n);
		previous = n;
	}
	return items;
}
