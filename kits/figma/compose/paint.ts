// El pintor de compose@1: cada bloque es un frame, una instancia de una hoja o un texto, y
// todo valor es una variable o un estilo del archivo (nada suelto). Lo que no se nombra no se inventa: un frame sin `fill` se
// queda sin relleno (no con el blanco de Figma, que no es de ninguna variable).
import { figmaApi, note } from "../core.ts";
import { loadFonts } from "../fonts.ts";
import { createInstance } from "../instances.ts";
import { setPaints } from "../paints.ts";
import { fillSlot } from "../slots.ts";
import { descendantsOfType, LINKABLE_TYPES } from "../tree.ts";
import type { FrameNode, SceneNode, Variable } from "../types.ts";
import type { Resolved } from "./resolve.ts";
import type { BlockData, StackData, TextData, UseData } from "./types.ts";

export type PaintCtx = Resolved & {
	// El frame del compose: lo que se pinta cuelga de él (o, el contenido de un slot, de paso por él)
	root: FrameNode;
	// Cuántas instancias de cada hoja
	used: Record<string, number>;
	texts: number;
	frames: number;
	slots: number;
};

const PADDING_FIELDS = [
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
] as const;
const RADIUS_FIELDS = [
	"topLeftRadius",
	"topRightRadius",
	"bottomRightRadius",
	"bottomLeftRadius",
] as const;
const FLOAT_FIELDS = [
	"itemSpacing",
	...PADDING_FIELDS,
	...RADIUS_FIELDS,
] as const;

// Un padding como en CSS: 1 valor (todos), 2 (vertical y horizontal), 3 (arriba, laterales y abajo) o 4 (los cuatro lados)
export function paddingSides(
	padding: string | readonly string[],
): readonly [string, string, string, string] {
	const p = typeof padding === "string" ? [padding] : padding;
	const [a = "", b = a, c = a, d = b] = p;
	return p.length === 1
		? [a, a, a, a]
		: p.length === 2
			? [a, b, a, b]
			: p.length === 3
				? [a, b, c, b]
				: [a, b, c, d];
}

const variableOf = (ctx: PaintCtx, name: string): Variable =>
	ctx.tokens.variable(name) as Variable;

// La disposición de un stack sobre un frame (nuevo o rehecho): lo anterior se suelta antes de ligar lo nuevo
export function applyStack(
	frame: FrameNode,
	block: StackData,
	ctx: PaintCtx,
): void {
	frame.layoutMode = block.stack as "VERTICAL" | "HORIZONTAL";
	for (const field of FLOAT_FIELDS) frame.setBoundVariable(field, null);
	if (block.gap !== undefined) {
		frame.setBoundVariable("itemSpacing", variableOf(ctx, block.gap));
	} else {
		frame.itemSpacing = 0;
	}
	if (block.padding !== undefined) {
		const sides = paddingSides(block.padding);
		PADDING_FIELDS.forEach((field, i) => {
			frame.setBoundVariable(field, variableOf(ctx, sides[i] as string));
		});
	} else {
		for (const field of PADDING_FIELDS) frame[field] = 0;
	}
	if (block.radius !== undefined) {
		const radius = variableOf(ctx, block.radius);
		for (const field of RADIUS_FIELDS) frame.setBoundVariable(field, radius);
	} else {
		frame.cornerRadius = 0;
	}
	// Medido en Figma real: volver a ligar un relleno que ya estaba ligado a esa variable no relee su color y el frame se queda
	// en negro. Se suelta siempre antes
	frame.fills = [];
	if (block.fill !== undefined) {
		setPaints(frame, "fills", [{ bind: variableOf(ctx, block.fill) }]);
	}
}

function paintStack(
	block: StackData,
	parent: FrameNode,
	ctx: PaintCtx,
): FrameNode {
	const frame = note.created(figmaApi().createFrame());
	frame.name = block.name ?? "Stack";
	// Auto-layout que se ajusta al contenido en los dos ejes; el `sizing` de después lo cambia si hace falta
	applyStack(frame, block, ctx);
	frame.primaryAxisSizingMode = "AUTO";
	frame.counterAxisSizingMode = "AUTO";
	parent.appendChild(frame);
	if (block.sizing !== undefined) {
		frame.layoutSizingHorizontal = block.sizing.h;
		frame.layoutSizingVertical = block.sizing.v;
	}
	ctx.frames += 1;
	return frame;
}

async function paintText(
	block: TextData,
	parent: FrameNode,
	ctx: PaintCtx,
): Promise<SceneNode> {
	const style = ctx.textStyles.get(block.style);
	const text = note.created(figmaApi().createText());
	// La fuente del estilo se carga antes de aplicarlo y de escribir el texto (si no, Figma lanza)
	if (style !== undefined) {
		await loadFonts([style.fontName]);
		await text.setTextStyleIdAsync(style.id);
	}
	text.characters = block.text;
	if (block.name !== undefined) text.name = block.name;
	parent.appendChild(text);
	if (block.color !== undefined) {
		setPaints(text, "fills", [{ bind: variableOf(ctx, block.color) }]);
	} else {
		note.warn(
			"TEXT_WITHOUT_COLOR",
			`El texto «${block.text}» no lleva \`color\`: se queda con el relleno por defecto de Figma, que no es de ninguna variable.`,
			text.id,
		);
	}
	// En una columna el texto ocupa el ancho y se parte en líneas; en una fila, lo que mide
	if (parent.layoutMode === "VERTICAL") {
		text.textAutoResize = "HEIGHT";
		text.layoutSizingHorizontal = "FILL";
	}
	ctx.texts += 1;
	return text;
}

async function paintUse(
	block: UseData,
	parent: FrameNode,
	ctx: PaintCtx,
): Promise<SceneNode> {
	const sheet = block.use as string;
	const set = ctx.sets.get(sheet);
	if (set === undefined) throw new Error(`Sin set para la hoja «${sheet}»`);
	const texts: Record<string, string> = {};
	// Un «Mostrar …» que el compose no nombra se queda como lo trae el set: `createInstance` apagaría por su cuenta los que no
	// tienen texto (regla de las pantallas de la web), y aquí lo único que se pide es lo que dice el compose
	const visible: Record<string, boolean> = {};
	for (const [key, def] of Object.entries(set.componentPropertyDefinitions)) {
		if (def.type === "BOOLEAN") {
			visible[key.split("#")[0] ?? key] = def.defaultValue as boolean;
		}
	}
	for (const [name, value] of Object.entries(block.props ?? {})) {
		if (typeof value === "string") texts[name] = value;
		else visible[name] = value;
	}
	const instance = await createInstance(set, {
		variant: block.variant ?? {},
		texts,
		visible,
	});
	if (block.name !== undefined) instance.name = block.name;
	parent.appendChild(instance);
	ctx.used[sheet] = (ctx.used[sheet] ?? 0) + 1;
	// El contenido de un slot entra como un clon: se pinta suelto en el frame del compose, se clona al slot
	// y el original se retira
	for (const [slot, children] of Object.entries(block.slots ?? {})) {
		for (const child of children) {
			const content = await paintBlock(child, ctx.root, ctx);
			fillSlot(instance, content, { slot });
			note.removed([content, ...descendantsOfType(content, LINKABLE_TYPES)]);
			content.remove();
			ctx.slots += 1;
		}
	}
	return instance;
}

export async function paintBlock(
	block: BlockData,
	parent: FrameNode,
	ctx: PaintCtx,
): Promise<SceneNode> {
	if ("stack" in block) {
		const frame = paintStack(block, parent, ctx);
		for (const child of block.children) await paintBlock(child, frame, ctx);
		return frame;
	}
	if ("text" in block) return paintText(block, parent, ctx);
	if ("use" in block) return paintUse(block, parent, ctx);
	throw new Error("Un bloque `image` o `icon` no lo pinta kit/compose@1");
}
