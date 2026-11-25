// kit/fill-image@1: la imagen real como relleno del nodo que lleva un texto (el mapa). Sustituye a
// mk_mapfill.py y mapfill*.js, sin base64 pegado en el script.
import { fail, figmaApi, note, startTracking } from "../core.ts";
import { imageInfo, MAX_IMAGE_SIDE } from "../images.ts";
import { descendantsOfType } from "../tree.ts";
import type { FrameNode, SceneNode } from "../types.ts";
import {
	type AreaParams,
	findAreaFrame,
	notFound,
	requirePage,
} from "./common.ts";

type Loose = Record<string, unknown>;

// El primer antecesor del texto de al menos ese tamaño, sin llegar al propio frame
function targetOf(
	frame: FrameNode,
	text: string,
	minSize: readonly [number, number],
): SceneNode | null {
	const label = descendantsOfType(frame, ["TEXT"]).find(
		(t) => (t as unknown as { characters: string }).characters.trim() === text,
	);
	let node: SceneNode | null = label ?? null;
	while (node !== null && node.id !== frame.id) {
		if (node.width >= minSize[0] && node.height >= minSize[1]) return node;
		node = node.parent as SceneNode | null;
	}
	return null;
}

export async function fillImage(
	params: AreaParams,
	assets: Readonly<Record<string, Uint8Array>>,
) {
	const area = params.area;
	const tracker = startTracking();
	const page = await requirePage(area);
	const fills = area.fills ?? [];

	const frames = new Map<string, FrameNode>();
	const missing: string[] = [];
	for (const fill of fills) {
		if (frames.has(fill.frame)) continue;
		const frame = await findAreaFrame(area, page, fill.frame);
		if (frame === null)
			missing.push(`el frame «${fill.frame}» de la página «${area.page}»`);
		else frames.set(fill.frame, frame);
	}
	if (missing.length > 0) notFound(missing);

	// Las imágenes se comprueban todas antes de crear ninguna (trampa 14)
	for (const fill of fills) {
		const bytes = assets[fill.asset];
		if (bytes === undefined) {
			fail(
				"ASSET_MISSING",
				`El paso no recibió los bytes de «${fill.asset}».`,
				"Comprueba que el fichero existe junto a areas.json y repite la llamada.",
			);
		}
		const info = imageInfo(bytes);
		if (info === null) {
			fail(
				"IMAGE_UNSUPPORTED",
				`«${fill.asset}» no es un PNG, un JPEG ni un GIF.`,
				"Convierte la imagen a PNG o JPEG y repite el paso.",
			);
		}
		if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) {
			fail(
				"IMAGE_UNSUPPORTED",
				`«${fill.asset}» mide ${info.width} × ${info.height} px y Figma admite hasta ${MAX_IMAGE_SIDE} por lado.`,
				"Reduce la imagen y repite el paso.",
			);
		}
	}

	const report: {
		frame: string;
		nodeId: string;
		size: [number, number];
		hash: string;
	}[] = [];
	for (const fill of fills) {
		const frame = frames.get(fill.frame) as FrameNode;
		const node = targetOf(frame, fill.find.text, fill.find.minSize);
		if (node === null) {
			note.warn(
				"FILL_TARGET_NOT_FOUND",
				`En «${fill.frame}» no hay un nodo de al menos ${fill.find.minSize[0]} × ${fill.find.minSize[1]} con el texto «${fill.find.text}».`,
				frame.id,
			);
			continue;
		}
		const image = figmaApi().createImage(assets[fill.asset] as Uint8Array);
		const target = node as unknown as Loose;
		const fills =
			(target["fills"] as { type: string; imageHash?: string }[]) ?? [];
		report.push({
			frame: fill.frame,
			nodeId: node.id,
			size: [Math.round(node.width), Math.round(node.height)],
			hash: image.hash,
		});
		if (fills.some((f) => f.type === "IMAGE" && f.imageHash === image.hash))
			continue;
		target["fills"] = [
			{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" },
		];
		if ("clipsContent" in target) target["clipsContent"] = true;
		if (fill.name !== undefined) node.name = fill.name;
		note.mutated(node);
	}
	return tracker.done({ fills: report });
}
