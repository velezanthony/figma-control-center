// Marcos por clave: se crean una vez y repetir el paso devuelve el mismo
import { fail, figmaApi, note } from "./core.ts";
import { nodeByKey, tagNode } from "./nodes.ts";
import type { FrameNode, PageNode, SceneNode } from "./types.ts";

// Lo que replaceContent copia del origen al marco. Cada una puede lanzar según el tipo de nodo
export const LAYOUT_PROPS = [
	"layoutMode",
	"primaryAxisSizingMode",
	"counterAxisSizingMode",
	"primaryAxisAlignItems",
	"counterAxisAlignItems",
	"itemSpacing",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"clipsContent",
	"fills",
] as const;

const messageOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

export async function ensureFrame(options: {
	key: string;
	page: PageNode;
	name: string;
	width: number;
	minHeight: number;
}): Promise<FrameNode> {
	const existing = await nodeByKey(options.key, { page: options.page });
	if (existing !== null) {
		if (existing.type === "FRAME") return existing;
		fail(
			"KEY_NOT_FRAME",
			`La clave «${options.key}» ya la tiene un nodo de tipo ${existing.type}, no un marco.`,
			"Usa otra clave para el marco o quita la del otro nodo.",
		);
	}
	const frame = figmaApi().createFrame();
	frame.name = options.name;
	frame.layoutMode = "VERTICAL";
	frame.resize(options.width, options.minHeight);
	frame.primaryAxisSizingMode = "AUTO";
	frame.minHeight = options.minHeight;
	options.page.appendChild(frame);
	tagNode(frame, options.key);
	note.created(frame);
	return frame;
}

// Vacía el marco y mete los hijos del origen conservando el id del marco (trampa 1: rehacerlo pierde enlaces y componentes).
// Los hijos movidos pueden cambiar de id al cambiar de página (trampa 2): se vuelve a leer la lista del marco y esos ids,
// no los de antes, son los que se declaran como creados
export async function replaceContent(
	frame: FrameNode,
	source: SceneNode,
	options: { copyLayout?: boolean } = {},
): Promise<readonly SceneNode[]> {
	// Los hijos fijos se ponen a 0 antes de vaciar (trampa 6)
	try {
		frame.numberOfFixedChildren = 0;
	} catch (e) {
		note.warn(
			"FIXED_FAILED",
			`No se pudo quitar lo fijo de «${frame.name}»: ${messageOf(e)}`,
			frame.id,
		);
	}
	const old = [...frame.children];
	note.removed(old);
	for (const child of old) child.remove();

	if (options.copyLayout === true) {
		const from = source as unknown as Record<string, unknown>;
		const to = frame as unknown as Record<string, unknown>;
		for (const prop of LAYOUT_PROPS) {
			try {
				to[prop] = from[prop];
			} catch (e) {
				note.warn(
					"LAYOUT_PROP",
					`No se pudo copiar «${prop}» al marco «${frame.name}»: ${messageOf(e)}`,
					frame.id,
				);
			}
		}
	}

	const incoming = (source as unknown as { children: readonly SceneNode[] })
		.children;
	for (const child of [...incoming]) frame.appendChild(child);
	const children = [...frame.children];
	note.created(children);
	note.mutated(frame);
	return children;
}
