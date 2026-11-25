// Diff de texto por líneas (Myers, con espacio lineal) y JSON canónico para compararlo. Puro y sin imports: sus tipos
// también los usa la web.

export const DIFF_OP = Object.freeze({
	context: "context",
	add: "add",
	del: "del",
} as const);

export type DiffOp = (typeof DIFF_OP)[keyof typeof DIFF_OP];

export type DiffLine = {
	readonly op: DiffOp;
	// Número de línea (desde 1) en cada lado; null en el lado donde la línea no existe
	readonly oldNo: number | null;
	readonly newNo: number | null;
	readonly text: string;
	// Esta línea es la última de su texto y no acaba en salto de línea
	readonly noEol?: true;
};

export type DiffHunk = {
	readonly oldStart: number;
	readonly oldLines: number;
	readonly newStart: number;
	readonly newLines: number;
	readonly lines: readonly DiffLine[];
};

export type DiffOutcome =
	| {
			readonly kind: "diff";
			readonly hunks: readonly DiffHunk[];
			readonly added: number;
			readonly removed: number;
	  }
	// La distancia entre los textos pasó del tope de trabajo: no se calcula
	| { readonly kind: "too_large" };

export type DiffOptions = {
	readonly context?: number;
	readonly maxEdits?: number;
};

export const DIFF_CONTEXT_LINES = 3;
const DEFAULT_MAX_EDITS = 20_000;

type Piece = { readonly text: string; readonly noEol: boolean };

// «a\r\nb» → a y b; un texto sin salto final marca su última línea; el vacío no tiene líneas
function splitLines(text: string): Piece[] {
	if (text === "") return [];
	const parts = text.split(/\r?\n/);
	const endsWithEol = text.endsWith("\n");
	if (endsWithEol) parts.pop();
	return parts.map((part, i) => ({
		text: part,
		noEol: !endsWithEol && i === parts.length - 1,
	}));
}

type Snake = { x: number; y: number; u: number; v: number; d: number };

// Camino de edición más corto dividido por la mitad (Myers 1986). a[aLo,aHi) contra b[bLo,bHi), ya recortados:
// ninguno vacío y sin prefijo ni sufijo común
function middleSnake(
	a: Int32Array,
	aLo: number,
	aHi: number,
	b: Int32Array,
	bLo: number,
	bHi: number,
	budget: number,
): Snake | null {
	const n = aHi - aLo;
	const m = bHi - bLo;
	const delta = n - m;
	const odd = (delta & 1) !== 0;
	const half = Math.ceil((n + m) / 2);
	const size = 2 * half + 3;
	const off = half + 1;
	const vf = new Int32Array(size);
	const vb = new Int32Array(size);
	for (let d = 0; d <= half; d++) {
		// El camino mide al menos 2d-1: pasado el tope, no merece seguir
		if (2 * d - 1 > budget) return null;
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (
				k === -d ||
				(k !== d && (vf[off + k - 1] ?? 0) < (vf[off + k + 1] ?? 0))
			) {
				x = vf[off + k + 1] ?? 0;
			} else {
				x = (vf[off + k - 1] ?? 0) + 1;
			}
			let y = x - k;
			const xs = x;
			const ys = y;
			while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
				x++;
				y++;
			}
			vf[off + k] = x;
			if (odd && k >= delta - (d - 1) && k <= delta + (d - 1)) {
				if (x + (vb[off + delta - k] ?? 0) >= n) {
					return { x: xs, y: ys, u: x, v: y, d: 2 * d - 1 };
				}
			}
		}
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (
				k === -d ||
				(k !== d && (vb[off + k - 1] ?? 0) < (vb[off + k + 1] ?? 0))
			) {
				x = vb[off + k + 1] ?? 0;
			} else {
				x = (vb[off + k - 1] ?? 0) + 1;
			}
			let y = x - k;
			const xs = x;
			const ys = y;
			while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) {
				x++;
				y++;
			}
			vb[off + k] = x;
			if (!odd && delta - k >= -d && delta - k <= d) {
				if (x + (vf[off + delta - k] ?? 0) >= n) {
					return { x: n - x, y: m - y, u: n - xs, v: m - ys, d: 2 * d };
				}
			}
		}
	}
	return null;
}

// Marca qué líneas de a se borran y cuáles de b se añaden. Devuelve false si se pasó del tope
function mark(
	a: Int32Array,
	b: Int32Array,
	deleted: Uint8Array,
	inserted: Uint8Array,
	maxEdits: number,
): boolean {
	let budget = maxEdits;
	const stack: [number, number, number, number][] = [
		[0, a.length, 0, b.length],
	];
	while (stack.length > 0) {
		let [aLo, aHi, bLo, bHi] = stack.pop()!;
		while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
			aLo++;
			bLo++;
		}
		while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
			aHi--;
			bHi--;
		}
		if (aLo === aHi) {
			budget -= bHi - bLo;
			if (budget < 0) return false;
			for (let j = bLo; j < bHi; j++) inserted[j] = 1;
			continue;
		}
		if (bLo === bHi) {
			budget -= aHi - aLo;
			if (budget < 0) return false;
			for (let i = aLo; i < aHi; i++) deleted[i] = 1;
			continue;
		}
		const snake = middleSnake(a, aLo, aHi, b, bLo, bHi, budget);
		if (snake === null) return false;
		stack.push(
			[aLo, aLo + snake.x, bLo, bLo + snake.y],
			[aLo + snake.u, aHi, bLo + snake.v, bHi],
		);
	}
	return true;
}

// Diff de dos textos por líneas, en bloques con `context` líneas de contexto (3 por defecto)
export function diffLines(
	before: string,
	after: string,
	options: DiffOptions = {},
): DiffOutcome {
	const context = options.context ?? DIFF_CONTEXT_LINES;
	const maxEdits = options.maxEdits ?? DEFAULT_MAX_EDITS;
	const oldLines = splitLines(before);
	const newLines = splitLines(after);

	// Cada línea (con su marca de salto final) a un número, para comparar enteros
	const ids = new Map<string, number>();
	const idOf = (piece: Piece) => {
		const key = piece.noEol ? `${piece.text}\u0000` : piece.text;
		let id = ids.get(key);
		if (id === undefined) {
			id = ids.size;
			ids.set(key, id);
		}
		return id;
	};
	const a = Int32Array.from(oldLines, idOf);
	const b = Int32Array.from(newLines, idOf);
	const deleted = new Uint8Array(a.length);
	const inserted = new Uint8Array(b.length);
	if (!mark(a, b, deleted, inserted, maxEdits)) return { kind: "too_large" };

	const all: DiffLine[] = [];
	let i = 0;
	let j = 0;
	let added = 0;
	let removed = 0;
	const line = (
		op: DiffOp,
		piece: Piece,
		oldNo: number | null,
		newNo: number | null,
	): DiffLine =>
		piece.noEol
			? { op, oldNo, newNo, text: piece.text, noEol: true }
			: { op, oldNo, newNo, text: piece.text };
	while (i < a.length || j < b.length) {
		if (i < a.length && deleted[i]) {
			all.push(line(DIFF_OP.del, oldLines[i]!, i + 1, null));
			removed++;
			i++;
		} else if (j < b.length && inserted[j]) {
			all.push(line(DIFF_OP.add, newLines[j]!, null, j + 1));
			added++;
			j++;
		} else {
			all.push(line(DIFF_OP.context, newLines[j]!, i + 1, j + 1));
			i++;
			j++;
		}
	}
	return { kind: "diff", hunks: toHunks(all, context), added, removed };
}

function toHunks(all: readonly DiffLine[], context: number): DiffHunk[] {
	const changed: number[] = [];
	all.forEach((l, idx) => {
		if (l.op !== DIFF_OP.context) changed.push(idx);
	});
	if (changed.length === 0) return [];
	// Rangos [from, to) de líneas con su contexto; se unen los que se tocan o se solapan
	const ranges: [number, number][] = [];
	for (const idx of changed) {
		const from = Math.max(0, idx - context);
		const to = Math.min(all.length, idx + context + 1);
		const last = ranges[ranges.length - 1];
		if (last !== undefined && from <= last[1]) last[1] = to;
		else ranges.push([from, to]);
	}
	return ranges.map(([from, to]) => {
		const lines = all.slice(from, to);
		const olds = lines.filter((l) => l.oldNo !== null);
		const news = lines.filter((l) => l.newNo !== null);
		return {
			oldStart: olds[0]?.oldNo ?? startBefore(all, from, "oldNo"),
			oldLines: olds.length,
			newStart: news[0]?.newNo ?? startBefore(all, from, "newNo"),
			newLines: news.length,
			lines,
		};
	});
}

// Un bloque sin líneas de un lado (todo añadido o todo borrado) empieza en la línea siguiente a la última anterior
function startBefore(
	all: readonly DiffLine[],
	from: number,
	side: "oldNo" | "newNo",
): number {
	for (let idx = from - 1; idx >= 0; idx--) {
		const no = all[idx]![side];
		if (no !== null) return no + 1;
	}
	return 1;
}

// Deja como mucho `max` líneas de diff en total (lo que se manda a un navegador o a un agente)
export function limitHunks(
	hunks: readonly DiffHunk[],
	max: number,
): { readonly hunks: readonly DiffHunk[]; readonly truncated: boolean } {
	let left = max;
	const kept: DiffHunk[] = [];
	let truncated = false;
	for (const hunk of hunks) {
		if (left <= 0) {
			truncated = true;
			break;
		}
		if (hunk.lines.length <= left) {
			kept.push(hunk);
			left -= hunk.lines.length;
			continue;
		}
		const lines = hunk.lines.slice(0, left);
		kept.push({
			...hunk,
			lines,
			oldLines: lines.filter((l) => l.oldNo !== null).length,
			newLines: lines.filter((l) => l.newNo !== null).length,
		});
		truncated = true;
		break;
	}
	return { hunks: truncated ? kept : hunks, truncated };
}

// Las primeras `max` líneas de un texto, cuántas tiene en total y si se cortó
export function limitText(
	text: string,
	max: number,
): {
	readonly content: string;
	readonly lines: number;
	readonly truncated: boolean;
} {
	const lines = splitLines(text).length;
	let cut = -1;
	for (let seen = 0; seen < max; seen++) {
		cut = text.indexOf("\n", cut + 1);
		if (cut === -1) return { content: text, lines, truncated: false };
	}
	return cut + 1 >= text.length
		? { content: text, lines, truncated: false }
		: { content: text.slice(0, cut + 1), lines, truncated: true };
}

const SIGN = { context: " ", add: "+", del: "-" } as const;
const NO_EOL = "\\ No newline at end of file";

// Los bloques como diff unificado de texto (sin las dos líneas de cabecera de fichero)
export function toUnifiedDiff(hunks: readonly DiffHunk[]): string {
	const out: string[] = [];
	for (const hunk of hunks) {
		out.push(
			`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
		);
		for (const l of hunk.lines) {
			out.push(`${SIGN[l.op]}${l.text}`);
			if (l.noEol) out.push(NO_EOL);
		}
	}
	return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const sortKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (!isObject(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortKeys(value[key])]),
	);
};

// JSON con sangría y las claves de cada objeto ordenadas: lo que se compara en un diff de JSON. Si no es JSON, tal cual
export function canonicalJson(text: string): string {
	try {
		return JSON.stringify(sortKeys(JSON.parse(text)), null, 2);
	} catch {
		return text;
	}
}
