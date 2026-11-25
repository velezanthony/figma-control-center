// Iconos con createNodeFromSvg: `vectorPaths` no acepta lineto implícito tras `M`
import { fail, figmaApi, note } from "./core.ts";
import type { FrameNode } from "./types.ts";

export function iconFromSvg(
	name: string,
	svg: string,
	options: { size?: number } = {},
): FrameNode {
	let frame: FrameNode;
	try {
		frame = figmaApi().createNodeFromSvg(svg);
	} catch (e) {
		return fail(
			"BAD_SVG",
			`Figma no pudo leer el SVG de «${name}»: ${e instanceof Error ? e.message : String(e)}`,
			"Comprueba que el SVG es válido y vuelve a ejecutar el paso.",
		);
	}
	frame.name = name;
	if (options.size !== undefined) frame.resize(options.size, options.size);
	note.created(frame);
	return frame;
}
