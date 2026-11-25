// Las imágenes de una captura: el kit las devuelve como `data:` y aquí se pasan
// a bytes con su sha256, su tamaño en píxeles (cabecera PNG o JPEG) y su tipo; el nodo se queda con `ref`. Una imagen
// que no se entiende se queda sin `ref` (el contrato la rechazará) y deja un aviso con la ruta del nodo.
import { createHash } from "node:crypto";
import type { CapturedImage } from "#application/ports/web-capturer.ts";
import type { CaptureWarning, ImageType } from "#domain/capture.ts";

const DATA_URL = /^data:image\/(png|jpeg);base64,(.*)$/s;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Marcadores SOF de JPEG (los que llevan alto y ancho), sin DHT (C4), JPG (C8) ni DAC (CC)
const JPEG_SOF = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function pngSize(b: Buffer): { width: number; height: number } | null {
	if (b.length < 24 || !PNG_SIGNATURE.every((x, i) => b[i] === x)) return null;
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b: Buffer): { width: number; height: number } | null {
	if (b[0] !== 0xff || b[1] !== 0xd8) return null;
	let at = 2;
	while (at + 9 < b.length) {
		if (b[at] !== 0xff) return null;
		const marker = b[at + 1] as number;
		const length = b.readUInt16BE(at + 2);
		if (JPEG_SOF.has(marker))
			return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) };
		at += 2 + length;
	}
	return null;
}

export function decodeImage(dataUrl: string): CapturedImage | null {
	const m = DATA_URL.exec(dataUrl);
	if (!m) return null;
	const type = m[1] as ImageType;
	const bytes = Buffer.from(m[2] as string, "base64");
	const size = type === "png" ? pngSize(bytes) : jpegSize(bytes);
	if (size === null || size.width === 0 || size.height === 0) return null;
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		bytes,
		...size,
		type,
	};
}

export function extractImages(nodes: readonly unknown[]): {
	readonly nodes: unknown[];
	readonly images: CapturedImage[];
	readonly warnings: CaptureWarning[];
} {
	const images = new Map<string, CapturedImage>();
	const warnings: CaptureWarning[] = [];
	const visit = (list: readonly unknown[]): unknown[] =>
		list.map((node) => {
			if (node === null || typeof node !== "object") return node;
			const { data, kids, ...rest } = node as Record<string, unknown>;
			const out: Record<string, unknown> = { ...rest };
			if (Array.isArray(kids)) out["kids"] = visit(kids);
			if (typeof data === "string") {
				const image = decodeImage(data);
				if (image === null)
					warnings.push({
						message: `imagen que no es PNG ni JPEG en \`${String(rest["path"])}\`: se queda sin ref`,
					});
				else {
					if (!images.has(image.sha256)) images.set(image.sha256, image);
					out["ref"] = image.sha256;
				}
			}
			return out;
		});
	return { nodes: visit(nodes), images: [...images.values()], warnings };
}
