// kit/place@1: del constructor temporal a su frame.
// El id de cada frame se conserva: le llegan enlaces (trampa 1).
import {
	findComponent,
	pickVariant,
	propsOfVariant,
	setNameOf,
} from "../components.ts";
import { figmaApi, note, startTracking } from "../core.ts";
import { ensureFrame, LAYOUT_PROPS, replaceContent } from "../frames.ts";
import { capture, restore } from "../links.ts";
import { findPage, removePage } from "../pages.ts";
import { setPaints } from "../paints.ts";
import { loadTokens } from "../tokens.ts";
import { descendantsOfType, insideInstance } from "../tree.ts";
import type {
	ComponentSetNode,
	FrameNode,
	PageNode,
	SceneNode,
} from "../types.ts";
import {
	type AreaData,
	type AreaParams,
	areaFrameKey,
	type Clickable,
	findAreaFrame,
	messageOf,
	notFound,
} from "./common.ts";

type Props = Record<string, unknown>;
const props = (node: unknown): Props => node as Props;

const STROKE_WEIGHTS = [
	"strokeTopWeight",
	"strokeRightWeight",
	"strokeBottomWeight",
	"strokeLeftWeight",
] as const;
const STROKE_TYPES = [
	"FRAME",
	"RECTANGLE",
	"VECTOR",
	"ELLIPSE",
	"LINE",
	"POLYGON",
	"STAR",
] as const;

// Lo que ha de existir en Figma antes de escribir nada: la página, el set del shell con sus variantes y la variable
async function preflight(area: AreaData): Promise<{
	page: PageNode;
	shell: ComponentSetNode | null;
	fill: ReturnType<Awaited<ReturnType<typeof loadTokens>>["variable"]>;
}> {
	const missing: string[] = [];
	const page = await findPage(area.page);
	if (page === null) missing.push(`la página «${area.page}»`);
	let shell: ComponentSetNode | null = null;
	if (area.shell !== undefined) {
		const found = await findComponent(area.shell.set);
		if (found === null)
			missing.push(`el componente «${area.shell.set}» (el shell)`);
		else if (found.type === "COMPONENT_SET") {
			shell = found;
			for (const screen of area.screens) {
				const value = screen.shell ?? area.shell.default;
				const has = found.children.some(
					(v) =>
						v.type === "COMPONENT" &&
						propsOfVariant(v)[area.shell?.variantProp ?? ""] === value,
				);
				if (!has)
					missing.push(
						`la variante «${area.shell.variantProp}=${value}» de «${area.shell.set}»`,
					);
			}
		}
	}
	let fill: ReturnType<Awaited<ReturnType<typeof loadTokens>>["variable"]>;
	if (area.frame.fill !== undefined) {
		fill = (await loadTokens()).variable(area.frame.fill);
		if (fill === undefined)
			missing.push(`la variable de color «${area.frame.fill}»`);
	}
	if (missing.length > 0 || page === null) notFound([...new Set(missing)]);
	return { page, shell, fill };
}

function tempPageFor(area: AreaData, frame: string): PageNode | null {
	const wanted = `${area.place.source.pagePrefix}${frame}`;
	const pages = figmaApi().root.children;
	return (
		pages.find((p) => p.name === wanted) ??
		pages.find((p) => p.name.trim() === wanted.trim()) ??
		null
	);
}

function originIn(
	page: PageNode,
	take: AreaData["place"]["source"]["take"],
): SceneNode | null {
	if (take === "first-frame")
		return page.children.find((c) => c.type === "FRAME") ?? null;
	if (take === "first-component")
		return (
			descendantsOfType(page as unknown as SceneNode, ["COMPONENT"])[0] ?? null
		);
	const set = descendantsOfType(page as unknown as SceneNode, [
		"COMPONENT_SET",
	])[0];
	return (
		(set as unknown as { children: SceneNode[] } | undefined)?.children[0] ??
		null
	);
}

// Un borde de 0,8 px (captura al 125 %) vuelve a su valor si es un múltiplo exacto de la escala
function scaledWeight(width: number, scale: number): number {
	const r = width / scale;
	return width > 0 &&
		Math.abs(r - Math.round(r)) < 0.02 &&
		Math.abs(width - Math.round(width)) > 0.05
		? Math.round(r)
		: width;
}

function scaleStrokes(frame: FrameNode, scale: number): void {
	for (const node of descendantsOfType(frame, STROKE_TYPES)) {
		const strokes = props(node)["strokes"];
		if (!Array.isArray(strokes) || strokes.length === 0 || insideInstance(node))
			continue;
		for (const weight of STROKE_WEIGHTS) {
			const current = props(node)[weight];
			if (typeof current !== "number") continue;
			const next = scaledWeight(current, scale);
			if (next !== current) {
				props(node)[weight] = next;
				note.mutated(node);
			}
		}
	}
}

const copyFrom = (from: unknown, to: unknown, frame: FrameNode) => {
	for (const prop of LAYOUT_PROPS) {
		if (prop === "fills") continue;
		try {
			props(to)[prop] = props(from)[prop];
		} catch (e) {
			note.warn(
				"LAYOUT_PROP",
				`No se pudo copiar «${prop}» a «${frame.name}»: ${messageOf(e)}`,
				frame.id,
			);
		}
	}
};

// Un envoltorio que contiene la capa del shell se aplana: su disposición pasa al frame y sus hijos suben un nivel
function unwrap(frame: FrameNode, holding: readonly string[]): void {
	if (frame.children.some((k) => holding.includes(k.name))) return;
	const wrap = frame.children.find(
		(k) =>
			k.type === "FRAME" && k.children.some((c) => holding.includes(c.name)),
	);
	if (wrap === undefined || wrap.type !== "FRAME") return;
	copyFrom(wrap, frame, frame);
	for (const child of [...wrap.children]) {
		frame.insertChild(frame.children.indexOf(wrap), child);
	}
	note.removed(wrap);
	wrap.remove();
	// Un marco vacío al lado (el contenedor de avisos) no es contenido
	for (const k of [...frame.children]) {
		if (k.type === "FRAME" && k.width < 1 && k.height < 1) {
			note.removed(k);
			k.remove();
		}
	}
}

// Ancho fijo y alto según el contenido, según el eje del auto-layout (una fila fija el ancho en el eje principal)
function fixWidth(frame: FrameNode, width: number): void {
	if (frame.layoutMode === "HORIZONTAL") {
		frame.primaryAxisSizingMode = "FIXED";
		frame.counterAxisSizingMode = "AUTO";
	} else if (frame.layoutMode === "VERTICAL") {
		frame.counterAxisSizingMode = "FIXED";
		frame.primaryAxisSizingMode = "AUTO";
	}
	frame.resize(width, frame.height);
	frame.counterAxisAlignItems = "MIN";
}

function ensureMinHeight(
	frame: FrameNode,
	width: number,
	minHeight: number,
): void {
	if (frame.height >= minHeight) return;
	if (frame.layoutMode === "HORIZONTAL") frame.counterAxisSizingMode = "FIXED";
	else if (frame.layoutMode === "VERTICAL")
		frame.primaryAxisSizingMode = "FIXED";
	frame.resize(width, minHeight);
}

// El primer hijo de la capa del shell pasa a ser una instancia de la variante de la pantalla; con `fixed`, la capa sale
// del flujo, queda la última y fija al hacer scroll (trampas 6 y 7)
function placeShell(
	area: AreaData,
	shell: ComponentSetNode,
	frame: FrameNode,
	value: string,
): void {
	const spec = area.shell;
	if (spec === undefined) return;
	const aside = frame.children.find((k) => spec.in.includes(k.name));
	const side = aside?.type === "FRAME" ? aside.children[0] : undefined;
	if (aside === undefined || aside.type !== "FRAME" || side === undefined)
		return;
	const variant = pickVariant(
		shell,
		{ [spec.variantProp]: value },
		{ strong: [spec.variantProp] },
	);
	const instance = variant.createInstance();
	aside.insertChild(aside.children.indexOf(side), instance);
	note.removed(side);
	side.remove();
	note.created(instance);
	instance.layoutAlign = "STRETCH";
	instance.layoutGrow = 1;
	if (spec.fixed === undefined) return;
	const width = aside.width;
	aside.layoutPositioning = "ABSOLUTE";
	aside.x = 0;
	aside.y = 0;
	aside.layoutMode = "VERTICAL";
	aside.resize(width, spec.fixed.height);
	frame.paddingLeft = width;
	frame.appendChild(aside);
	note.mutated(aside);
}

// La capa del shell queda fija al hacer scroll; si Figma lanza o no la cuenta, se avisa y el frame queda colocado (trampa 6)
function fixShell(frame: FrameNode): void {
	try {
		frame.numberOfFixedChildren = 1;
	} catch (e) {
		note.warn(
			"FIXED_FAILED",
			`«${frame.name}» no queda fijo al hacer scroll: ${messageOf(e)}`,
			frame.id,
		);
		return;
	}
	if (frame.numberOfFixedChildren !== 1) {
		note.warn(
			"FIXED_FAILED",
			`«${frame.name}» no queda fijo al hacer scroll: Figma dejó ${frame.numberOfFixedChildren} hijos fijos (solo fija los últimos hijos que están fuera del flujo).`,
			frame.id,
		);
	}
}

async function placeReplace(
	area: AreaData,
	frame: FrameNode,
	origin: SceneNode,
	shell: ComponentSetNode | null,
	value: string,
	fill: Awaited<ReturnType<typeof preflight>>["fill"],
): Promise<void> {
	await replaceContent(frame, origin, { copyLayout: true });
	if (area.place.unwrap !== undefined) unwrap(frame, area.place.unwrap.holding);
	fixWidth(frame, area.frame.width);
	const main = frame.children.find((k) => area.main?.includes(k.name));
	if (main !== undefined && "layoutGrow" in main) main.layoutGrow = 1;
	if (shell !== null) placeShell(area, shell, frame, value);
	ensureMinHeight(frame, area.frame.width, area.frame.minHeight);
	// Medido en el archivo de pruebas (2026-11-15): en un marco con auto-layout solo cuentan como fijos los últimos hijos que están
	// fuera del flujo, y la capa del shell lo está (placeShell la deja ABSOLUTE y la última). No se cambia `overflowDirection`
	// (cambiaría el scroll del prototipo)
	if (area.shell?.fixed !== undefined) fixShell(frame);
	if (area.place.strokeScale !== undefined)
		scaleStrokes(frame, area.place.strokeScale);
	if (
		fill !== undefined &&
		fill !== null &&
		(frame.fills as readonly unknown[]).length === 0
	) {
		setPaints(frame, "fills", [{ bind: fill }]);
	}
	note.mutated(frame);
}

async function placeTransplant(
	area: AreaData,
	clickable: Clickable,
	frame: FrameNode,
	origin: SceneNode,
): Promise<{ restored: number; total: number } | null> {
	const keep = new Set(area.place.keep ?? []);
	const old: SceneNode[] = [];
	for (const child of frame.children) {
		const kept =
			child.type === "INSTANCE" && keep.has((await setNameOf(child)) ?? "");
		if (!kept) old.push(child);
	}
	if (old.length === 0) {
		note.warn(
			"NO_CONTENT",
			`«${frame.name}» no tiene contenido propio que sustituir.`,
			frame.id,
		);
		return null;
	}
	const drop = area.place.drop ?? [];
	const kids = [...(origin as unknown as { children: SceneNode[] }).children];
	const mid = kids.filter(
		(k, i) => !((i === 0 || i === kids.length - 1) && drop.includes(k.name)),
	);
	const saved = old.flatMap((o) => capture(o));
	const at = frame.children.indexOf(old[0] as SceneNode);
	note.removed(old);
	for (const o of old) o.remove();
	mid.forEach((k, i) => {
		frame.insertChild(at + i, k);
		props(k)["layoutAlign"] = "STRETCH";
	});
	// Los ids pueden haber cambiado al mover de página: se vuelve a leer lo que hay en el frame (trampa 2)
	const placed = frame.children.slice(at, at + mid.length);
	note.created(placed);
	note.mutated(frame);
	return restore(placed, saved, { clickable });
}

// Borra las páginas temporales; la abierta no se puede borrar (trampa 9): antes se abre la del área
async function removeTemps(
	page: PageNode,
	temps: readonly PageNode[],
): Promise<void> {
	const alive = temps.filter((p) => !p.removed);
	if (alive.length === 0) return;
	const open = figmaApi().currentPage;
	if (alive.some((p) => p.id === open.id))
		await figmaApi().setCurrentPageAsync(page);
	for (const temp of alive) await removePage(temp);
}

export async function place(params: AreaParams) {
	const area = params.area;
	const tracker = startTracking();
	const { page, shell, fill } = await preflight(area);
	const frames: {
		frame: string;
		id: string;
		height: number;
		shell?: string;
	}[] = [];
	const relinked: { frame: string; restored: number; total: number }[] = [];
	const consumed: PageNode[] = [];

	// Si un frame falla a mitad, el archivo no se queda con páginas temporales: se borran todas las del área (el constructor
	// las vuelve a pintar) y el error sigue su camino
	try {
		for (const screen of area.screens) {
			let frame = await findAreaFrame(area, page, screen.frame);
			const temp = tempPageFor(area, screen.frame);
			if (temp === null) {
				note.warn(
					"NO_SOURCE",
					`No hay página temporal para «${screen.frame}»: se deja como está.`,
					frame?.id,
				);
				continue;
			}
			const origin = originIn(temp, area.place.source.take);
			if (origin === null) {
				note.warn(
					"NO_SOURCE",
					`La página «${temp.name}» no tiene ${area.place.source.take}: «${screen.frame}» se deja como está.`,
					frame?.id,
				);
				continue;
			}
			frame ??= await ensureFrame({
				key: areaFrameKey(area.name, screen.frame),
				page,
				name: screen.frame,
				width: area.frame.width,
				minHeight: area.frame.minHeight,
			});
			const value = screen.shell ?? area.shell?.default ?? "";
			if (area.place.mode === "transplant") {
				const done = await placeTransplant(
					area,
					area.clickable ?? params.linkRules.clickable,
					frame,
					origin,
				);
				if (done !== null) relinked.push({ frame: screen.frame, ...done });
			} else {
				await placeReplace(area, frame, origin, shell, value, fill);
			}
			consumed.push(temp);
			frames.push({
				frame: screen.frame,
				id: frame.id,
				height: Math.round(frame.height),
				...(area.shell !== undefined &&
					area.place.mode === "replace-content" && { shell: value }),
			});
		}
	} catch (e) {
		if (area.place.source.remove !== false)
			await removeTemps(
				page,
				area.screens
					.map((screen) => tempPageFor(area, screen.frame))
					.filter((p) => p !== null),
			);
		throw e;
	}

	if (area.place.source.remove !== false) await removeTemps(page, consumed);
	return tracker.done({
		frames,
		...(area.place.mode === "transplant" && { relinked }),
	});
}
