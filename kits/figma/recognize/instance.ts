// La instancia de un componente reconocido por su huella. Props por votación de las clases
// condicionales de la plantilla (o sus valores por defecto); textos alineados con las capas del componente por texto, tamaño y
// peso; los «Mostrar…» sin pareja se apagan. Lo que es del proyecto y no de la
// herramienta (la ilustración de una tarjeta de KPI, los booleanos que solo reordenan hijos) va al `after` del set
// (recognize@1).
import { propsOfVariant } from "../components.ts";
import { figmaApi } from "../core.ts";
import { ensureFonts } from "../fonts.ts";
import { setPaints } from "../paints.ts";
import type { Ctx } from "../screen/ctx.ts";
import type { Fingerprint, Font, PlanNode } from "../screen/types.ts";
import { descendantsOfType, LINKABLE_TYPES } from "../tree.ts";
import type {
	ComponentNode,
	ComponentSetNode,
	InstanceNode,
	SceneNode,
	TextNode,
} from "../types.ts";
import { fpMatch, fpSet, type IsGeneric } from "./fingerprint.ts";
import { iconInstances, recolorIcon } from "./recolor.ts";
import type { RuleCtx } from "./types.ts";

type Defs = ComponentSetNode["componentPropertyDefinitions"];
type Refs = Record<string, string | undefined>;

const norm = (s: string | undefined): string =>
	(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const SEPARATOR = /^[/›>»·|]$/;
// Convenciones de nombre del sistema de diseño: capas de ayuda, de icono y el estado «cerrado» de un componente emergente
const HELP_LAYER = /ayuda|help/i;
const ICON_LAYER = /icono|icon/i;
const ICON_SWAP = /^icono/i;
const CLOSED = "closed";
const MAX_DEPTH = 4;
const WIDTH_TOLERANCE = 1.5;
const COLOR_PROP = /color/i;

const refsOf = (n: SceneNode): Refs =>
	((n as unknown as { componentPropertyReferences: Refs | null })
		.componentPropertyReferences ?? {}) as Refs;
const textsIn = (n: SceneNode): TextNode[] =>
	(n.type === "TEXT"
		? [n]
		: descendantsOfType(n, ["TEXT"])) as unknown as TextNode[];
const options = (def: Defs[string]): readonly string[] =>
	(def as { variantOptions?: readonly string[] }).variantOptions ?? [];

// Los textos propios del nodo con su letra heredada; no baja a un subcomponente reconocido (sus textos son suyos)
function ownTexts(
	n: PlanNode,
	key: string,
	fps: Readonly<Record<string, Fingerprint>>,
	isGeneric: IsGeneric,
): { txt: string; font: Font | undefined }[] {
	const out: { txt: string; font: Font | undefined }[] = [];
	const walk = (x: PlanNode, f: Font | undefined): void => {
		const ff = x.font ?? f;
		if (x !== n && x.tag) {
			const m = fpMatch(x, fps, isGeneric);
			if (m && m.key !== key) return;
		}
		if (x.t === "text" && (x.txt ?? "").trim())
			out.push({ txt: x.txt as string, font: ff });
		for (const k of x.kids ?? []) walk(k, ff);
	};
	walk(n, n.font);
	return out;
}

export async function fpInstance(
	ctx: Ctx,
	rc: RuleCtx,
	n: PlanNode,
	key: string,
	set: ComponentSetNode,
	fps: Readonly<Record<string, Fingerprint>>,
	isGeneric: IsGeneric,
): Promise<InstanceNode | null> {
	const fp = fps[key] as Fingerprint;
	const f = figmaApi();

	// props por votación de clases condicionales: la raíz pesa más (una text-sm interior no debe decidir size=sm)
	const tally: Record<string, number> = {};
	const vote = (x: PlanNode, d: number, font: Font | undefined): void => {
		if (d > MAX_DEPTH) return;
		const ff = x.font ?? font;
		// el número grande decide su color, no el enlace del pie
		const big = ff && ff.size >= 20 ? 2 : 0;
		for (const c of fpSet(x.cls)) {
			const cv = fp.cond?.[c];
			if (cv) {
				const k = `${cv[0]}=${cv[1]}`;
				tally[k] = (tally[k] ?? 0) + (d === 0 ? 3 : 1) + big;
			}
		}
		for (const k of x.kids ?? []) vote(k, d + 1, ff);
	};
	vote(n, 0, n.font);
	const votes: Record<string, string> = {};
	for (const [kv] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
		const [pk, pv] = kv.split("=") as [string, string];
		if (!(pk in votes)) votes[pk] = pv;
	}

	const defs = set.componentPropertyDefinitions;
	const want: Record<string, string> = {};
	// strong: cambia la estructura → manda al elegir variante
	const strong = new Set<string>();
	for (const [fk, def] of Object.entries(defs)) {
		if (def.type !== "VARIANT") continue;
		// varios props del código → un variant de Figma: gana el booleano activo cuyo nombre es una opción
		const als = Object.entries(fp.alias ?? {}).filter(
			([, name]) => norm(name) === norm(fk),
		);
		const on = als.find(
			([c]) => votes[c] === "true" && options(def).includes(c),
		);
		if (on) {
			want[fk] = on[0];
			strong.add(fk);
			continue;
		}
		const al = als[0];
		const codeKey = al
			? al[0]
			: Object.keys({ ...fp.defaults, ...votes }).find(
					(c) => norm(c) === norm(fk),
				);
		if (!codeKey) continue;
		const v = String(
			votes[codeKey] ?? fp.defaults?.[codeKey] ?? "",
		).toLowerCase();
		const opt = options(def).find((o) => o.toLowerCase() === v);
		if (opt) want[fk] = opt;
	}

	// textos libres (sets sin props de texto, p. ej. un recorrido de migas): variante numérica = nº de textos que no son separador
	const freeT = ownTextsAll(n);
	const hasTextProps = Object.values(defs).some((d) => d.type === "TEXT");
	if (!hasTextProps) {
		for (const [fk, def] of Object.entries(defs)) {
			if (def.type !== "VARIANT" || !options(def).every((o) => /^\d+$/.test(o)))
				continue;
			const cnt = String(freeT.filter((t) => !SEPARATOR.test(t)).length);
			if (options(def).includes(cnt)) {
				want[fk] = cnt;
				strong.add(fk);
			}
		}
	}
	// estado abierto/cerrado de un componente emergente: en la captura la burbuja oculta no trae texto → cerrado
	for (const [fk, def] of Object.entries(defs)) {
		if (
			def.type === "VARIANT" &&
			options(def).includes(CLOSED) &&
			freeT.length <= 1
		) {
			want[fk] = CLOSED;
			strong.add(fk);
		}
	}

	let comp: ComponentNode | null = null;
	let best = -1;
	for (const c of set.children) {
		if (c.type !== "COMPONENT") continue;
		const vp = propsOfVariant(c);
		let sc = 0;
		for (const [k, v] of Object.entries(want))
			if (vp[k] === v) sc += strong.has(k) ? 10 : 1;
		if (sc > best) {
			best = sc;
			comp = c;
		}
	}
	if (!comp) return null;
	const inst = comp.createInstance();
	await ensureFonts(inst);
	const upd: Record<string, string | boolean> = {};

	// textos: capas de texto enlazadas a una prop, alineadas con los textos del nodo por tamaño y peso (DP); las que sobran se apagan
	// dueño de una prop: la instancia más cercana (esta o una anidada, p. ej. la etiqueta dentro de un selector) que la define
	const owner = (x: SceneNode, key2: string): InstanceNode | null => {
		for (let p = x.parent; p; p = p.parent) {
			if (
				p.type === "INSTANCE" &&
				p.componentProperties &&
				key2 in p.componentProperties
			)
				return p;
			if (p === inst) break;
		}
		return null;
	};
	const L = textsIn(inst).filter(
		(x) =>
			x.visible &&
			refsOf(x)["characters"] !== undefined &&
			owner(x, refsOf(x)["characters"] as string),
	);
	const nested = new Map<InstanceNode, Record<string, string>>();
	// los textos de un subcomponente reconocido (el «?» de un componente emergente) no son textos de este: no se emparejan
	const subs = new Set<string>();
	const findSubs = (x: PlanNode): void => {
		for (const k of x.kids ?? []) {
			const m2 = k.tag ? fpMatch(k, fps, isGeneric) : null;
			if (m2 && m2.key !== key)
				subs.add((fps[m2.key] as Fingerprint).title.toLowerCase());
			else findSubs(k);
		}
	};
	findSubs(n);
	const T = ownTexts(n, key, fps, isGeneric);
	const weights = ctx.plan.map.fonts.styles;
	const sim = (l: TextNode, t: (typeof T)[number]): number => {
		const fs = t.font?.size;
		const fw = t.font ? weights[t.font.weight] : undefined;
		let sc = l.characters.trim() === t.txt.trim() ? 3 : 0;
		if (fs && typeof l.fontSize === "number" && Math.abs(l.fontSize - fs) <= 1)
			sc += 2;
		// un 24 px no es un texto de 12
		if (fs && typeof l.fontSize === "number" && Math.abs(l.fontSize - fs) > 6)
			return -3;
		const fn = l.fontName;
		if (fw && fn !== f.mixed && fn.style === fw) sc += 1;
		return sc ? sc : -0.5;
	};
	const NEG = -1e9;
	const D = Array.from({ length: L.length + 1 }, () =>
		Array<number>(T.length + 1).fill(NEG),
	);
	(D[0] as number[])[0] = 0;
	const at = (i: number, j: number): number => (D[i] as number[])[j] as number;
	for (let i = 0; i <= L.length; i++) {
		for (let j = 0; j <= T.length; j++) {
			const row = D[i] as number[];
			if (i && at(i - 1, j) > NEG) row[j] = Math.max(at(i, j), at(i - 1, j));
			if (j && at(i, j - 1) > NEG)
				row[j] = Math.max(at(i, j), at(i, j - 1) - 1);
			if (i && j && at(i - 1, j - 1) > NEG)
				row[j] = Math.max(
					at(i, j),
					at(i - 1, j - 1) +
						sim(L[i - 1] as TextNode, T[j - 1] as (typeof T)[number]),
				);
		}
	}
	const pair = new Map<TextNode, (typeof T)[number]>();
	for (let i = L.length, j = T.length; i > 0 && j > 0; ) {
		if (
			at(i, j) ===
			at(i - 1, j - 1) +
				sim(L[i - 1] as TextNode, T[j - 1] as (typeof T)[number])
		) {
			pair.set(L[i - 1] as TextNode, T[j - 1] as (typeof T)[number]);
			i--;
			j--;
		} else if (at(i, j) === at(i - 1, j)) i--;
		else j--;
	}
	for (const l of L) {
		const key2 = refsOf(l)["characters"] as string;
		const t = pair.get(l);
		const o = owner(l, key2);
		if (t && o !== inst && o !== null) {
			if (!nested.has(o)) nested.set(o, {});
			(nested.get(o) as Record<string, string>)[key2] = t.txt;
			continue;
		}
		if (o !== inst) continue;
		if (t) upd[key2] = t.txt;
		else {
			let a: SceneNode | null = l;
			while (a && a !== inst) {
				const vref = refsOf(a)["visible"];
				if (vref && defs[vref]) {
					upd[vref] = false;
					break;
				}
				a = a.parent as SceneNode | null;
			}
		}
	}

	// «Mostrar…» cuyas capas no recibieron nada del nodo (ni texto ni icono) se apagan: p. ej. el «?» de ayuda o la fila de comparativa
	const paired = new Set<TextNode>(pair.keys());
	const hasIcon = rc.findSvg(n) !== undefined;
	for (const node of descendantsOfType(inst, LINKABLE_TYPES)) {
		const vref = refsOf(node)["visible"];
		if (!vref || !defs[vref]) continue;
		if (vref in upd) continue;
		const gotText = textsIn(node).some((t) => paired.has(t));
		const isIcon = ICON_LAYER.test(node.name);
		if (HELP_LAYER.test(node.name) && subs.has("tooltip")) continue;
		if (!gotText && !(isIcon && hasIcon)) upd[vref] = false;
	}

	// icono: el svg reconocido del nodo va al hueco «Icono…» del componente
	const sv = rc.findSvg(n);
	const ic = sv?.key === undefined ? undefined : rc.iconOf(sv.key);
	const swap = Object.entries(defs).find(
		([k, d]) => d.type === "INSTANCE_SWAP" && ICON_SWAP.test(k),
	);
	const iconId = ic === undefined ? undefined : rc.icon(ic);
	if (iconId !== undefined && swap) upd[swap[0]] = iconId;
	try {
		inst.setProperties(upd);
	} catch (e) {
		ctx.warn(
			"FP_PROPS",
			`${fp.title}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (!hasTextProps) {
		const tl = textsIn(inst).filter((x) => x.visible);
		if (tl.length === freeT.length) {
			for (const [i, t] of tl.entries()) {
				if (t.characters === freeT[i]) continue;
				await ensureFonts(t);
				t.characters = freeT[i] as string;
			}
		} else {
			ctx.warn(
				"FP_TEXTS",
				`${fp.title}: ${tl.length} capas de texto y ${freeT.length} textos.`,
			);
		}
	}
	// icono cambiado por swap: llega con su color por defecto → se repinta con el del svg capturado (blanco sobre el círculo oscuro…)
	if (sv?.color) {
		for (const icon of iconInstances(ctx, inst).slice(0, 1))
			recolorIcon(ctx, icon, sv.color, [sv.cls ?? "", n.cls ?? ""]);
	}
	for (const [o, u] of nested) {
		try {
			o.setProperties(u);
		} catch (e) {
			ctx.warn(
				"FP_NESTED",
				`${fp.title}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
	// color pedido que la variante elegida no tiene: se copia el relleno de una variante que sí lo tenga
	const own = propsOfVariant(comp);
	for (const [fk, v] of Object.entries(want)) {
		if (!COLOR_PROP.test(fk) || own[fk] === v) continue;
		const donor = set.children.find(
			(c) => c.type === "COMPONENT" && propsOfVariant(c)[fk] === v,
		);
		if (!donor) continue;
		for (const dl of textsIn(donor)) {
			const ref = refsOf(dl)["characters"];
			if (!ref) continue;
			const same = (x: TextNode) => refsOf(x)["characters"] === ref;
			const il = textsIn(inst).find(same);
			const base = textsIn(comp).find(same);
			if (
				il &&
				base &&
				dl.fills !== f.mixed &&
				JSON.stringify(base.fills) !== JSON.stringify(dl.fills)
			)
				setPaints(il, "fills", dl.fills as never, { track: false });
		}
	}
	// h-full: en la web se estira al alto de la fila (rejilla de tarjetas): mismo alto que la captura
	const hFull = fpSet(n.cls).has("h-full") && n.h > inst.height;
	if ((Math.abs(inst.width - n.w) > WIDTH_TOLERANCE && n.w > 0) || hFull) {
		try {
			inst.resize(n.w || inst.width, hFull ? n.h : inst.height);
		} catch (e) {
			ctx.warn(
				"FP_RESIZE",
				`${fp.title}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
	return inst;
}

// Todos los textos del nodo, sin saltarse subcomponentes (los «textos libres»)
function ownTextsAll(n: PlanNode): string[] {
	const out: string[] = [];
	const walk = (x: PlanNode): void => {
		if (x.t === "text" && (x.txt ?? "").trim())
			out.push((x.txt as string).trim());
		for (const k of x.kids ?? []) walk(k);
	};
	walk(n);
	return out;
}
