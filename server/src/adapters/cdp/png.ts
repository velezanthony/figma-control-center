// Ancho y alto de un PNG: los dos enteros big-endian del chunk IHDR (RFC 2083). null si no caben los bytes
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_HEADER_BYTES = 24;

export const pngSize = (
	png: Buffer,
): { readonly width: number; readonly height: number } | null =>
	png.length < PNG_HEADER_BYTES
		? null
		: {
				width: png.readUInt32BE(PNG_WIDTH_OFFSET),
				height: png.readUInt32BE(PNG_HEIGHT_OFFSET),
			};
