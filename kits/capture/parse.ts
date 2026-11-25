// Piezas de valores que no necesitan DOM (se prueban en Node): `px`, `luminance`, `shadows`, `gradient` y `splitTop`,
// El color llega como función (`color`, que en
// el navegador pinta en un canvas): así estas piezas no tocan el DOM.
import type { Gradient, GradientStop, Rgba, Shadow } from "./types.ts";

export type ColorOf = (c: string) => Rgba | null;

export const px = (v: string): number => parseFloat(v) || 0;

export const luminance = (c: Rgba): number => {
	const f = (x: number) => {
		x /= 255;
		return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

export const shadows = (v: string, color: ColorOf): Shadow[] =>
	!v || v === "none"
		? []
		: v
				.split(/,(?![^(]*\))/)
				.map((part): Shadow | null => {
					const m = /([a-z-]+\([^)]*\)|#[0-9a-f]+)/i.exec(part);
					if (!m) return null;
					const c = color(m[1] as string);
					if (!c) return null;
					const n = (
						part.replace(m[1] as string, "").match(/-?[\d.]+px/g) || []
					)
						.map(parseFloat)
						.concat([0, 0, 0, 0]);
					return {
						c,
						x: n[0] as number,
						y: n[1] as number,
						b: n[2] as number,
						s: n[3] as number,
						inset: /inset/.test(part),
					};
				})
				.filter((s): s is Shadow => s !== null);

// Parte por comas de primer nivel (las de dentro de paréntesis no cuentan)
export function splitTop(str: string): string[] {
	const out: string[] = [];
	let d = 0;
	let cur = "";
	for (const ch of str) {
		if (ch === "(") d++;
		if (ch === ")") d--;
		if (ch === "," && d === 0) {
			out.push(cur.trim());
			cur = "";
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

// linear-gradient computado → { angle (CSS, grados), stops: [{ c: rgba, p: 0..1 }] }; null si no hay o no es lineal
export function gradient(
	bgi: string,
	w: number,
	h: number,
	color: ColorOf,
): Gradient | null {
	const rad = /^radial-gradient\((.*)\)$/.exec((bgi || "").trim());
	if (rad) {
		const parts = splitTop(rad[1] as string);
		if (/^(circle|ellipse|closest|farthest|at )/.test(parts[0] ?? ""))
			parts.shift();
		const st2 = parts.map((st): { c: Rgba; p: number | null } => {
			const pm = /\s(-?[\d.]+)%$/.exec(st);
			const raw = pm ? st.slice(0, pm.index) : st;
			return {
				c: color(raw) || [0, 0, 0, 0],
				p: pm ? parseFloat(pm[1] as string) / 100 : null,
			};
		});
		st2.forEach((x, i) => {
			if (x.p == null) x.p = i / Math.max(1, st2.length - 1);
		});
		// transparent → mismo color que el stop vecino con alfa 0 (evita el gris de interpolar hacia negro)
		st2.forEach((x, i) => {
			if (x.c[3] === 0) {
				const nb = st2[i - 1] || st2[i + 1];
				if (nb) x.c = [nb.c[0], nb.c[1], nb.c[2], 0];
			}
		});
		return st2.length >= 2
			? { radial: true, stops: st2 as GradientStop[] }
			: null;
	}
	const m = /^linear-gradient\((.*)\)$/.exec((bgi || "").trim());
	if (!m) return null;
	const parts = splitTop(m[1] as string);
	let angle = 180;
	const head = (parts[0] ?? "")
		.replace(/\bin [a-z]+( (shorter|longer|increasing|decreasing) hue)?/, "")
		.trim();
	if (/deg$/.test(head)) {
		angle = parseFloat(head);
		parts.shift();
	} else if (/^to /.test(head)) {
		const k = head.slice(3).split(/\s+/);
		const sx = k.includes("right") ? 1 : k.includes("left") ? -1 : 0;
		const sy = k.includes("bottom") ? 1 : k.includes("top") ? -1 : 0;
		const dx = sx && sy ? sx * h : sx;
		const dy = sx && sy ? sy * w : sy;
		angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
		parts.shift();
	} else if (head === "") parts.shift();
	const stops = parts
		.map((st): { c: Rgba | null; p: number | null } => {
			const pm = /\s(-?[\d.]+)%$/.exec(st);
			return {
				c: color(pm ? st.slice(0, pm.index) : st),
				p: pm ? parseFloat(pm[1] as string) / 100 : null,
			};
		})
		.filter((x) => x.c);
	if (stops.length < 2) return null;
	stops.forEach((x, i) => {
		if (x.p == null) x.p = i / (stops.length - 1);
	});
	return { angle, stops: stops as GradientStop[] };
}
