// El reconocedor: antes de pintar un nodo, las reglas del proyecto (recognize@1) en su orden y
// después las huellas. Con una coincidencia el subárbol capturado NO se pinta: solo la instancia, con su ancho capturado.
// Lo que es de un componente concreto (Td/Th, Textarea, Logo, Flag, ilustraciones de KPI) lo decide el proyecto
// con `fit`, el `after` de la regla y el `after` del set.
import { propsOfVariant } from "../components.ts";
import { figmaApi } from "../core.ts";
import { ensureFonts } from "../fonts.ts";
import { setPaints } from "../paints.ts";
import type { Ctx } from "../screen/ctx.ts";
import { paintNode } from "../screen/frame.ts";
import { allText } from "../screen/layers.ts";
import { applySegs, mergedLists } from "../screen/text.ts";
import type { PlanNode, Rgba } from "../screen/types.ts";
import { descendantsOfType } from "../tree.ts";
import type {
	ComponentNode,
	ComponentSetNode,
	FrameNode,
	InstanceNode,
	SceneNode,
	TextNode,
} from "../types.ts";
import { FAIL_MARKER, KIT_GLOBAL } from "../types.ts";
import { type Catalog, loadCatalog } from "./catalog.ts";
import { fpMatch, genericMatcher, type IsGeneric } from "./fingerprint.ts";
import { fpInstance } from "./instance.ts";
import { iconInstances, recolorIcon } from "./recolor.ts";
import type {
	RecognizeModule,
	Rule,
	RuleCtx,
	RuleResult,
	VariantWanted,
} from "./types.ts";

export type Recognizer = {
	recognize(n: PlanNode, chain: readonly string[]): Promise<SceneNode | null>;
	// Al acabar la pantalla: lo pintado aparte entra en el hueco de su instancia
	flush(): void;
};

const WIDTH_TOLERANCE = 1.5;
const FIT_TOLERANCE = 2;
const SAME_TOLERANCE = 1;
const ZERO4: readonly number[] = [0, 0, 0, 0];
const PROP_SEPARATOR = "#";

export const findSvg = (n: PlanNode): PlanNode | undefined =>
	n.t === "svg" ? n : (n.kids ?? []).map(findSvg).find((x) => x !== undefined);

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// Un `kit.fail` (p. ej. una fuente que falta) para el paso: no es un fallo de la regla
const isKitFail = (e: unknown): boolean =>
	e instanceof Error && e.message.startsWith(FAIL_MARKER);

const px = (value: number) => ({ unit: "PIXELS", value }) as const;

const matches = (
	set: ComponentSetNode,
	wanted: VariantWanted,
): ComponentNode | undefined =>
	set.children.find((c): c is ComponentNode => {
		if (c.type !== "COMPONENT") return false;
		const props = propsOfVariant(c);
		return typeof wanted === "function"
			? wanted({ name: c.name, variantProperties: props })
			: Object.entries(wanted).every(([k, v]) => props[k] === v);
	});

export async function createRecognizer(
	ctx: Ctx,
	module: RecognizeModule | null,
): Promise<Recognizer | null> {
	const fps = ctx.plan.fingerprints;
	const hasFingerprints = fps !== undefined && Object.keys(fps).length > 0;
	if (module === null && !hasFingerprints) return null;

	const only = ctx.plan.rules === undefined ? null : new Set(ctx.plan.rules);
	const rules: [string, Rule][] = Object.entries(module?.rules ?? {}).filter(
		([name]) => only === null || only.has(name),
	);
	const titles = hasFingerprints
		? Object.values(fps).map((fp) => fp.title)
		: [];
	const catalog = await loadCatalog(
		rules.map(([name]) => name),
		titles,
	);
	const isGeneric: IsGeneric = genericMatcher(
		ctx.plan.map.components?.genericClasses ?? [],
	);
	const deferred: { instance: InstanceNode; frame: SceneNode }[] = [];

	const rc = ruleCtx(ctx, catalog, deferred, (n) =>
		hasFingerprints ? fpMatch(n, fps, isGeneric) : null,
	);
	// los hooks `after` se buscan por el nombre del set sin distinguir mayúsculas (la huella se llama como el set, a veces con otra caja)
	const hooks = new Map(
		Object.entries(module?.after ?? {}).map(([k, v]) => [
			k.trim().toLowerCase(),
			v,
		]),
	);

	// Lo que hace falta de una instancia ya creada, igual para una regla que para una huella
	const count = (set: string, node: PlanNode, by: string): void => {
		ctx.counters.nodes++;
		ctx.counters.components[set] = (ctx.counters.components[set] ?? 0) + 1;
		ctx.counters.matches.push({ node: node.id, set, by });
	};

	// borde que pone el contenedor (divide-y) y que el átomo no trae
	const border = (inst: SceneNode, n: PlanNode): void => {
		const bw = n.bw ?? ZERO4;
		const strokes = (inst as unknown as { strokes: unknown[] }).strokes ?? [];
		if (!bw.some((b) => b > 0) || !n.bc || strokes.length > 0) return;
		const node = inst as unknown as FrameNode;
		setPaints(
			node,
			"strokes",
			[ctx.paint.paint(n.bc, [n.cls ?? ""], "stroke")],
			{
				track: false,
			},
		);
		node.strokeAlign = "INSIDE";
		[
			node.strokeTopWeight,
			node.strokeRightWeight,
			node.strokeBottomWeight,
			node.strokeLeftWeight,
		] = bw as [number, number, number, number];
	};

	// Átomo enlazado al que el contenedor pone padding/fondo desde fuera: marco con ese hueco alrededor
	const boxAround = (
		inst: InstanceNode,
		n: PlanNode,
		fit: RuleResult["fit"],
	): SceneNode => {
		const pad = n.pad ?? ZERO4;
		// el átomo ya trae su padding: el hueco «de más» es solo que la fila es más alta → alto de la fila
		if (fit === "height") {
			if (Math.abs(inst.height - n.h) > SAME_TOLERANCE)
				inst.resize(inst.width, n.h);
			return inst;
		}
		const fitsW =
			Math.abs(inst.width + (pad[1] ?? 0) + (pad[3] ?? 0) - n.w) <
			FIT_TOLERANCE;
		const fitsH =
			Math.abs(inst.height + (pad[0] ?? 0) + (pad[2] ?? 0) - n.h) <
			FIT_TOLERANCE;
		if (
			!pad.some((x) => x > 0) ||
			!(fitsW || fitsH) ||
			(Math.abs(inst.width - n.w) < SAME_TOLERANCE &&
				Math.abs(inst.height - n.h) < SAME_TOLERANCE)
		)
			return inst;
		const w = figmaApi().createFrame();
		ctx.counters.nodes++;
		w.name = inst.name;
		setPaints(
			w,
			"fills",
			n.bg ? [ctx.paint.paint(n.bg, [n.cls ?? ""], "fill")] : [],
			{ track: false },
		);
		w.clipsContent = false;
		w.layoutMode = "HORIZONTAL";
		w.primaryAxisSizingMode = "AUTO";
		w.counterAxisSizingMode = "AUTO";
		w.counterAxisAlignItems = "CENTER";
		[w.paddingTop, w.paddingRight, w.paddingBottom, w.paddingLeft] = pad as [
			number,
			number,
			number,
			number,
		];
		[
			w.topLeftRadius,
			w.topRightRadius,
			w.bottomRightRadius,
			w.bottomLeftRadius,
		] = (n.rad ?? ZERO4) as [number, number, number, number];
		w.appendChild(inst);
		return w;
	};

	// Lo que `nestInstance` hacía tras crear la instancia de una regla: iconos repintados, texto enriquecido y ancho capturado
	const retouch = async (inst: InstanceNode, n: PlanNode): Promise<void> => {
		// icono cambiado por swap: el nuevo llega con su color por defecto → se repinta con el color real
		const svgs: PlanNode[] = [];
		const rec = (x: PlanNode): void => {
			for (const k of x.kids ?? []) {
				if (k.t === "svg" && k.color) svgs.push(k);
				else if (k.t === "frame") rec(k);
			}
		};
		rec(n);
		for (const [i, icon] of iconInstances(ctx, inst).entries()) {
			const sv = svgs[i];
			if (sv?.color)
				recolorIcon(ctx, icon, sv.color, [sv.cls ?? "", n.cls ?? ""]);
		}
		const lists = mergedLists(n);
		const rich = (descendantsOfType(inst, ["TEXT"]) as TextNode[]).filter(
			(x) => x.name === "texto enriquecido",
		);
		for (let i = 0; i < Math.min(lists.length, rich.length); i++) {
			await ensureFonts(rich[i] as TextNode);
			applySegs(ctx, rich[i] as TextNode, lists[i] as never, [n.cls ?? ""]);
		}
		if (Math.abs(inst.width - n.w) > WIDTH_TOLERANCE)
			inst.resize(n.w, inst.height);
	};

	const afterSet = async (
		name: string,
		inst: InstanceNode,
		n: PlanNode,
	): Promise<void> => {
		const hook = hooks.get(name.trim().toLowerCase());
		if (hook !== undefined) await hook(inst, n, rc);
	};

	const byRule = async (
		name: string,
		rule: Rule,
		set: ComponentSetNode,
		n: PlanNode,
		cls: Set<string>,
	): Promise<SceneNode | null> => {
		let inst: InstanceNode | null = null;
		try {
			if (!rule.match(n, cls, rc)) return null;
			const r = rule.props(n, cls, rc);
			const comp = matches(set, r.variant);
			if (comp === undefined) {
				ctx.warn(
					"VARIANT_NOT_FOUND",
					`«${name}» no tiene la variante ${typeof r.variant === "function" ? "pedida" : JSON.stringify(r.variant)}: el nodo se prueba con otra regla o se pinta.`,
				);
				return null;
			}
			inst = comp.createInstance();
			await ensureFonts(inst);
			const defs = set.componentPropertyDefinitions;
			const upd: Record<string, string | boolean> = {};
			for (const [k, v] of Object.entries(r.set ?? {})) {
				const key = Object.keys(defs).find(
					(x) => x.split(PROP_SEPARATOR)[0] === k,
				);
				if (key === undefined) {
					ctx.warn(
						"PROP_NOT_FOUND",
						`«${name}» no tiene una propiedad «${k}».`,
					);
				} else if (v !== undefined) upd[key] = v;
			}
			inst.setProperties(upd);
			if (r.after) await r.after(inst);
			await afterSet(name, inst, n);
			if (r.fit !== "none") await retouch(inst, n);
			count(name, n, `rule:${name}`);
			if (r.fit === "none") return inst;
			border(inst, n);
			return boxAround(inst, n, r.fit);
		} catch (e) {
			inst?.remove();
			if (isKitFail(e)) throw e;
			ctx.warn(
				"RULE_ERROR",
				`La regla «${name}» falló en el nodo ${n.id} (${n.tag ?? n.t}): ${errorText(e)}. Se prueba con otra o se pinta.`,
				n.id,
			);
			return null;
		}
	};

	const byFingerprint = async (n: PlanNode): Promise<SceneNode | null> => {
		if (!hasFingerprints || n.t !== "frame") return null;
		const m = fpMatch(n, fps, isGeneric);
		if (m === null) return null;
		// un componente no se anida a sí mismo, y su huella no cede el sitio a la siguiente
		if (m.title.toLowerCase() === ctx.ownTitle?.toLowerCase()) return null;
		const set = catalog.set(m.title);
		if (set === undefined) return null;
		let inst: InstanceNode | null = null;
		try {
			inst = await fpInstance(ctx, rc, n, m.key, set, fps, isGeneric);
			if (inst === null) return null;
			await afterSet(set.name.trim(), inst, n);
			count(set.name.trim(), n, "fingerprint");
			border(inst, n);
			return boxAround(inst, n, undefined);
		} catch (e) {
			inst?.remove();
			if (isKitFail(e)) throw e;
			ctx.warn(
				"RULE_ERROR",
				`La huella «${m.title}» falló en el nodo ${n.id} (${n.tag ?? n.t}): ${errorText(e)}. Se pinta el nodo.`,
				n.id,
			);
			return null;
		}
	};

	const missing = new Set<string>();
	return {
		async recognize(n) {
			const cls = new Set((n.cls ?? "").split(" "));
			for (const [name, rule] of rules) {
				const set = catalog.set(name);
				if (set === undefined) {
					if (!missing.has(name)) {
						missing.add(name);
						ctx.warn(
							"SET_NOT_FOUND",
							`No hay un set «${name}» en el archivo: su regla no se prueba.`,
						);
					}
					continue;
				}
				const made = await byRule(name, rule, set, n, cls);
				if (made !== null) return made;
			}
			return byFingerprint(n);
		},
		flush() {
			for (const { instance, frame } of deferred.splice(0)) {
				const slot = (
					instance.findAllWithCriteria({ types: ["SLOT"] }) as SceneNode[]
				)[0] as (SceneNode & { appendChild(n: SceneNode): void }) | undefined;
				if (slot === undefined) {
					ctx.warn(
						"SLOT_MISSING",
						`La instancia «${instance.name}» no tiene hueco para el contenido aparte.`,
						instance.id,
					);
					frame.remove();
					continue;
				}
				// se mete un clon: una instancia con textos editados a mano y movida a un slot queda con capas «inexistentes»
				const clone = frame.clone();
				slot.appendChild(clone);
				frame.remove();
				try {
					(clone as FrameNode).layoutSizingHorizontal = "FILL";
				} catch (e) {
					ctx.warn(
						"LAYOUT_PROP",
						`El contenido de «${instance.name}» no pudo ocupar todo el ancho del hueco: ${errorText(e)}`,
						clone.id,
					);
				}
			}
		},
	};
}

const hasKit = (): unknown =>
	(globalThis as unknown as Record<string, unknown>)[KIT_GLOBAL];

function ruleCtx(
	ctx: Ctx,
	catalog: Catalog,
	deferred: { instance: InstanceNode; frame: SceneNode }[],
	fingerprintOf: (n: PlanNode) => { key: string; title: string } | null,
): RuleCtx {
	const solid = (color: Rgba) => ({
		type: "SOLID" as const,
		color: { r: color[0] / 255, g: color[1] / 255, b: color[2] / 255 },
		opacity: color[3],
	});
	const rc: RuleCtx = {
		allText,
		findSvg,
		// la pantalla de una hoja cambia de raíces y de props entre una variante y otra: se leen en cada llamada
		get roots() {
			return ctx.plan.root;
		},
		fingerprintOf: (n) => {
			const m = fingerprintOf(n);
			return m === null ? null : { key: m.key, title: m.title };
		},
		icon: (name) => ctx.icons.get(name)?.id,
		iconOf: (key) => ctx.plan.icons[key],
		get screenProps() {
			return ctx.plan.props;
		},
		set: (name) => catalog.set(name),
		async defer(instance, node, chain = []) {
			const frame = await paintNode(ctx, node, chain);
			frame.name = "contenido de la celda";
			figmaApi().currentPage.appendChild(frame);
			deferred.push({ instance, frame });
		},
		paint(node, field, color, chain, kind = "fill") {
			setPaints(node, field, [ctx.paint.paint(color, chain, kind)], {
				track: false,
			});
		},
		solid(node, field, color) {
			setPaints(node, field, [solid(color)], { track: false });
		},
		textStyleOf(font) {
			const name = ctx.text.fontName(font);
			const base = ctx.text.style(font.weight);
			return ctx.text.isStrict(name.family)
				? ctx.text.strictStyle(name.family, font, base)
				: ctx.text.textStyle(name.family, font.size, base);
		},
		isStrictFamily: (font) => ctx.text.isStrict(ctx.text.fontName(font).family),
		async styleLike(t, f, chain) {
			const name = ctx.text.fontName(f);
			const base = ctx.text.style(f.weight);
			const cur = t.fontName;
			if (
				cur === figmaApi().mixed ||
				cur.family !== name.family ||
				cur.style !== name.style ||
				t.fontSize !== f.size
			) {
				const strict = ctx.text.isStrict(name.family);
				const ts = strict
					? undefined
					: ctx.text.textStyle(name.family, f.size, base);
				if (ts && f.fs !== "italic") await t.setTextStyleIdAsync(ts.id);
				else {
					await t.setTextStyleIdAsync("");
					t.fontName = name;
					t.fontSize = f.size;
				}
				const lh = Number.parseFloat(f.lh);
				if (
					!Number.isNaN(lh) &&
					!(
						ts !== undefined &&
						ts.lineHeight.unit === "PIXELS" &&
						Math.abs(ts.lineHeight.value - lh) < 0.01
					)
				)
					t.lineHeight = px(lh);
			}
			if (f.ls !== "normal" && Number.parseFloat(f.ls))
				t.letterSpacing = px(Number.parseFloat(f.ls));
			if (f.color) {
				const fills = t.fills;
				const first = Array.isArray(fills) ? fills[0] : undefined;
				const c = f.color;
				const color = first && "color" in first ? first.color : undefined;
				if (
					!color ||
					Math.abs(color.r * 255 - c[0]) > 1 ||
					Math.abs(color.g * 255 - c[1]) > 1 ||
					Math.abs(color.b * 255 - c[2]) > 1
				)
					setPaints(t, "fills", [ctx.paint.paint(c, chain, "text")], {
						track: false,
					});
			}
		},
		warn: (code, message, nodeId) => ctx.warn(code, message, nodeId),
		get kit() {
			return hasKit();
		},
	};
	return rc;
}
