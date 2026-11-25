// Huellas de componentes: reconocer un componente por sus clases fijas, sin regla escrita a mano.
// Etiqueta + todas las clases fijas de la raíz; si el componente tiene una
// firma «siempre presente», tiene que aparecer dentro; si la raíz es genérica (menos de 2 clases que lo distingan), hace falta
// además alguna firma. Gana la huella más específica. Las clases genéricas llegan en map@1 (`components.genericClasses`).
import type { Fingerprint, FingerprintSig, PlanNode } from "../screen/types.ts";

export type FpMatch = { key: string; title: string; score: number };
export type IsGeneric = (cls: string) => boolean;

export const fpSet = (s: string | undefined): Set<string> =>
	new Set((s ?? "").split(/\s+/).filter(Boolean));

const fpHas = (cls: ReadonlySet<string>, need: readonly string[]): boolean =>
	need.every((c) => cls.has(c));

// Cada entrada es una expresión regular sobre la clase entera
export function genericMatcher(patterns: readonly string[]): IsGeneric {
	const regexes = patterns.map((p) => new RegExp(`^(?:${p})$`));
	return (cls) => regexes.some((re) => re.test(cls));
}

// Las clases de una huella que sí la distinguen
const distinct = (cls: readonly string[], isGeneric: IsGeneric): string[] =>
	cls.filter((c) => !isGeneric(c));

export function fpFindDesc(
	n: PlanNode,
	sig: FingerprintSig,
	depth = 0,
	max = 4,
): boolean {
	if (depth > max) return false;
	for (const k of n.kids ?? []) {
		if (k.tag === sig.tag && fpHas(fpSet(k.cls), sig.cls)) return true;
		if (fpFindDesc(k, sig, depth + 1, max)) return true;
	}
	return false;
}

export function fpMatch(
	n: PlanNode | null | undefined,
	fingerprints: Readonly<Record<string, Fingerprint>>,
	isGeneric: IsGeneric,
	skip?: ReadonlySet<string>,
): FpMatch | null {
	if (!n?.tag) return null;
	const cls = fpSet(n.cls);
	let best: FpMatch | null = null;
	for (const [key, fp] of Object.entries(fingerprints)) {
		if (skip?.has(fp.title) || fp.tag !== n.tag || !fpHas(cls, fp.cls))
			continue;
		// raíz genérica: la firma tiene que estar cerca (hijo o nieto); si no, casaría con cualquier contenedor que la incluya
		const weak = distinct(fp.cls, isGeneric).length < 2;
		const max = weak ? 1 : 4;
		const always = fp.sig ? fpFindDesc(n, fp.sig, 0, max) : false;
		// su firma siempre está: si no aparece, no es este componente
		if (fp.sig && !always) continue;
		const sig =
			always || (fp.sig_cond ? fpFindDesc(n, fp.sig_cond, 0, max) : false);
		if (weak && !sig) continue;
		const score =
			distinct(fp.cls, isGeneric).length + (sig ? 3 : 0) + fp.cls.length / 100;
		if (!best || score > best.score) best = { key, title: fp.title, score };
	}
	return best;
}
