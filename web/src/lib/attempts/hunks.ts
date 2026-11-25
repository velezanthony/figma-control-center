import type { DiffHunk, DiffLine } from "#web/lib/contract.ts";

// Salta al bloque siguiente (n) o al anterior (p); en los extremos se queda. Sin foco (-1), n va al primero y p al
// último. Otra tecla, o sin bloques: null
export function nextHunk(
	current: number,
	count: number,
	key: string,
): number | null {
	if (count === 0) return null;
	if (key === "n") return Math.min(count - 1, current + 1);
	if (key === "p") return current < 0 ? count - 1 : Math.max(0, current - 1);
	return null;
}

const range = (from: number, to: number) =>
	from === to ? `línea ${from}` : `líneas ${from} a ${to}`;

// «cambio 2 de 5, líneas 40 a 52»: con los números del lado nuevo; si el bloque solo borra, los del viejo
export function hunkTitle(
	hunk: DiffHunk,
	index: number,
	count: number,
): string {
	const head = `cambio ${index + 1} de ${count}`;
	const news = hunk.lines.filter((l) => l.newNo !== null);
	if (news.length > 0) {
		return `${head}, ${range(news[0]?.newNo ?? 0, news[news.length - 1]?.newNo ?? 0)}`;
	}
	const olds = hunk.lines.filter((l) => l.oldNo !== null);
	return `${head}, ${range(olds[0]?.oldNo ?? 0, olds[olds.length - 1]?.oldNo ?? 0)} (borradas)`;
}

// El contenido de un papel como un solo bloque de contexto: el mismo componente lo pinta sin el otro lado
export function contentHunk(content: string): DiffHunk {
	const parts = content === "" ? [] : content.split(/\r?\n/);
	if (content.endsWith("\n")) parts.pop();
	const lines: DiffLine[] = parts.map((text, i) => ({
		op: "context",
		oldNo: i + 1,
		newNo: i + 1,
		text,
	}));
	return {
		oldStart: 1,
		oldLines: lines.length,
		newStart: 1,
		newLines: lines.length,
		lines,
	};
}
