// Color → variable (kit.tokens.paint). Primero la variable de la clase del elemento
// o de sus antecesores cuyo color coincide; si ninguna, la primera variable de la colección de respaldo con ese color; si
// tampoco, el color suelto. Las clases y las colecciones llegan en map@1, no están escritas aquí.
import type { PaintInput } from "../paints.ts";
import type { TokenEntry, Tokens } from "../tokens.ts";
import type { Variable } from "../types.ts";
import type { PlanMap, Rgba } from "./types.ts";

type TokenMap = PlanMap["tokens"];

export type PaintKind = "fill" | "text" | "stroke" | "svg";

export type PaintResolver = {
	// El relleno o borde para ese color: ligado a su variable si la hay, suelto si no (y se cuenta como sin variable)
	paint(color: Rgba, chain: readonly string[], kind: PaintKind): PaintInput;
	// La variable de un número (radio, espaciado) por valor exacto, ±0,01
	numVar(kind: "radius" | "spacing", value: number): Variable | null;
	// La variable del radio «completo» (el de las esquinas de 9999)
	fullRadius(): Variable | null;
	byName(name: string): Variable | undefined;
};

const hex = (r: number, g: number, b: number): string =>
	[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

const colorOf = (entry: TokenEntry): string | null => {
	if (entry.variable.resolvedType !== "COLOR") return null;
	const c = entry.value as { r: number; g: number; b: number } | undefined;
	return c === undefined ? null : hex(c.r * 255, c.g * 255, c.b * 255);
};

export function createPaintResolver(
	tokens: Tokens,
	config: TokenMap,
	onUntokenized: (color: string) => void,
): PaintResolver {
	const rules = config.classToVariable.map((r) => ({
		pattern: new RegExp(r.from),
		to: r.to,
	}));
	const hexOf = new Map<Variable, string>();
	const fallback = new Map<string, Variable>();
	const numbers: { name: string; value: number; variable: Variable }[] = [];
	for (const entry of tokens.entries()) {
		const color = colorOf(entry);
		if (color !== null) {
			hexOf.set(entry.variable, color);
			if (
				config.fallback !== undefined &&
				entry.collection === config.fallback.collection &&
				!fallback.has(color)
			)
				fallback.set(color, entry.variable);
		} else if (
			entry.variable.resolvedType === "FLOAT" &&
			typeof entry.value === "number"
		) {
			numbers.push({
				name: entry.name,
				value: entry.value,
				variable: entry.variable,
			});
		}
	}

	// La primera regla que da una variable que existe
	const classVar = (token: string): Variable | undefined => {
		for (const rule of rules) {
			const m = rule.pattern.exec(token);
			if (m === null) continue;
			const name = rule.to.replace(
				/\$(\d+)/g,
				(_, i: string) => m[Number(i)] ?? "",
			);
			const found = tokens.variable(name);
			if (found !== undefined) return found;
		}
		return undefined;
	};

	const prefixesOf = (kind: PaintKind): readonly string[] => {
		const p = config.classPrefixes;
		return kind === "svg"
			? [...(p.svg ?? [...p.text, ...p.stroke, ...p.fill])]
			: p[kind];
	};

	const pick = (
		color: Rgba,
		chain: readonly string[],
		kind: PaintKind,
	): Variable | null => {
		const wanted = hex(color[0], color[1], color[2]);
		const prefixes = prefixesOf(kind);
		for (const classes of chain) {
			for (const c of classes.split(" ")) {
				if (c === "" || c.includes(":")) continue;
				for (const prefix of prefixes) {
					if (!c.startsWith(prefix)) continue;
					const v = classVar(c.slice(prefix.length).split("/")[0] ?? "");
					if (v !== undefined && hexOf.get(v) === wanted) return v;
				}
			}
		}
		return fallback.get(wanted) ?? null;
	};

	return {
		paint(color, chain, kind) {
			const variable = pick(color, chain, kind);
			if (variable !== null) return { bind: variable, opacity: color[3] };
			onUntokenized(hex(color[0], color[1], color[2]));
			return {
				type: "SOLID",
				color: { r: color[0] / 255, g: color[1] / 255, b: color[2] / 255 },
				opacity: color[3],
			};
		},
		numVar(kind, value) {
			const prefix = config.numbers?.[kind]?.prefix;
			if (prefix === undefined) return null;
			const hit = numbers.find(
				(n) => n.name.startsWith(prefix) && Math.abs(n.value - value) < 0.01,
			);
			return hit?.variable ?? null;
		},
		fullRadius() {
			const name = config.numbers?.radius?.full;
			return name === undefined ? null : (tokens.variable(name) ?? null);
		},
		byName: (name) => tokens.variable(name),
	};
}
