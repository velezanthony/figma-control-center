import type { BuildStepResultItem } from "#domain/history.ts";

const CONTINUATION_MASK = 0b1100_0000;
const CONTINUATION = 0b1000_0000;

// Extracto corto del resultado de un paso: su JSON compacto cortado a `maxBytes` bytes, sin partir un carácter de
// varios bytes. `bytes` es lo que ocupa entero, para que quien lo lee sepa cuánto falta.
export function excerptOf(
	value: unknown,
	maxBytes: number,
): Extract<BuildStepResultItem, { kind: "inline" }> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	if (bytes.byteLength <= maxBytes) {
		return {
			kind: "inline",
			excerpt: new TextDecoder().decode(bytes),
			bytes: bytes.byteLength,
			truncated: false,
		};
	}
	let cut = maxBytes;
	while (cut > 0 && ((bytes[cut] ?? 0) & CONTINUATION_MASK) === CONTINUATION) {
		cut -= 1;
	}
	return {
		kind: "inline",
		excerpt: new TextDecoder().decode(bytes.subarray(0, cut)),
		bytes: bytes.byteLength,
		truncated: true,
	};
}
