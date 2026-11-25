// Lo que un plan (screen@1 o component@1) saca de los nodos de una captura: las imágenes (con su asset), los iconos del
// catálogo por su clave y los avisos de lo que no se puede pintar tal cual. Compartido por las pantallas y las hojas.
import type { CaptureImage, CaptureNode } from "#domain/capture.ts";
import { iconKey } from "#domain/icon-key.ts";
import {
	MAX_FIGMA_IMAGE_SIDE,
	PLAN_WARNING,
	type PlanImage,
} from "#domain/screen-plan.ts";
import type { WebCaptureStore } from "./ports/web-capture-store.ts";

export type PlanAssetWarning = {
	readonly code:
		| typeof PLAN_WARNING.imageTooLarge
		| typeof PLAN_WARNING.iconKeyUnknown;
	readonly nodeId: string;
	readonly message: string;
};

export type PlanAssets = {
	readonly images: Record<string, PlanImage>;
	readonly icons: Record<string, string>;
	// Una entrada por imagen que cabe en Figma (su sha256) → ruta real
	readonly assets: Record<string, string>;
	readonly warnings: PlanAssetWarning[];
};

function walk(nodes: readonly CaptureNode[], visit: (n: CaptureNode) => void) {
	for (const node of nodes) {
		visit(node);
		if (node.t === "frame") walk(node.kids, visit);
	}
}

export function collectPlanAssets(
	roots: readonly (readonly CaptureNode[])[],
	captureImages: Readonly<Record<string, CaptureImage>>,
	store: Pick<WebCaptureStore, "imageFile">,
	catalog: readonly { readonly name: string; readonly svg: string }[],
): PlanAssets {
	const out: PlanAssets = { images: {}, icons: {}, assets: {}, warnings: [] };
	const names = new Map(catalog.map((i) => [iconKey(i.svg), i.name]));
	for (const nodes of roots) {
		walk(nodes, (node) => {
			if (node.t === "img") {
				const image = captureImages[node.ref];
				if (image === undefined) return;
				const tooLarge =
					image.width > MAX_FIGMA_IMAGE_SIDE ||
					image.height > MAX_FIGMA_IMAGE_SIDE;
				if (out.images[node.ref] === undefined) {
					out.images[node.ref] = {
						asset: node.ref,
						width: image.width,
						height: image.height,
						type: image.type,
						...(tooLarge && { tooLarge: true }),
					};
					if (!tooLarge) {
						out.assets[node.ref] = store.imageFile({
							sha256: node.ref,
							type: image.type,
						});
					}
				}
				if (tooLarge) {
					out.warnings.push({
						code: PLAN_WARNING.imageTooLarge,
						nodeId: node.id,
						message: `La imagen ${node.ref.slice(0, 8)} mide ${image.width} × ${image.height}: Figma no admite más de ${MAX_FIGMA_IMAGE_SIDE} px por lado; se pintará un rectángulo sin imagen.`,
					});
				}
			} else if (node.t === "svg") {
				const key = node.key ?? iconKey(node.svg);
				const name = names.get(key);
				if (name === undefined) {
					out.warnings.push({
						code: PLAN_WARNING.iconKeyUnknown,
						nodeId: node.id,
						message:
							"Un svg no está en el catálogo de iconos: se pintará con createNodeFromSvg.",
					});
				} else out.icons[key] = name;
			}
		});
	}
	return out;
}
