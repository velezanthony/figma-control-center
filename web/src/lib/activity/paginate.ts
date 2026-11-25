export const PER_PAGE_CHOICES = [10, 25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 25;

export type PageWindow = {
	readonly page: number;
	readonly pageCount: number;
	// Rango [start, end) sobre la lista; from/to son los números que se muestran (1-based)
	readonly start: number;
	readonly end: number;
	readonly from: number;
	readonly to: number;
	readonly total: number;
};

// La ventana sobre el total que dice el servidor. La página se ajusta a [1, pageCount]: si los filtros reducen el total no queda una página vacía
export function paginate(
	total: number,
	page: number,
	perPage: number,
): PageWindow {
	const pageCount = Math.max(1, Math.ceil(total / perPage));
	const safe = Number.isFinite(page) ? Math.trunc(page) : 1;
	const current = Math.min(pageCount, Math.max(1, safe));
	const start = (current - 1) * perPage;
	const end = Math.min(start + perPage, total);
	return {
		page: current,
		pageCount,
		start,
		end,
		from: total === 0 ? 0 : start + 1,
		to: end,
		total,
	};
}
