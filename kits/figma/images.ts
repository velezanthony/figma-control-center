// Cabecera de una imagen: formato (PNG, JPEG o GIF) y tamaño. Lo justo para decidir antes de `createImage` si Figma la
// aceptará (trampa 14: más de 4096 px por lado o otro formato falla)
export type ImageInfo = {
	type: "png" | "jpeg" | "gif";
	width: number;
	height: number;
};

export const MAX_IMAGE_SIDE = 4096;

export function imageInfo(bytes: Uint8Array): ImageInfo | null {
	const u16 = (i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
	const u32 = (i: number) => (u16(i) * 65536 + u16(i + 2)) >>> 0;
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
		return { type: "png", width: u32(16), height: u32(20) };
	}
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		const le = (i: number) => (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8);
		return { type: "gif", width: le(6), height: le(8) };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		for (let i = 2; i + 9 < bytes.length; ) {
			if (bytes[i] !== 0xff) return null;
			const marker = bytes[i + 1] ?? 0;
			// SOF0 a SOF3: alto y ancho
			if (marker >= 0xc0 && marker <= 0xc3) {
				return { type: "jpeg", height: u16(i + 5), width: u16(i + 7) };
			}
			i += 2 + u16(i + 2);
		}
	}
	return null;
}
