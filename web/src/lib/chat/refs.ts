export type RefPart =
	| { readonly t: "text"; readonly text: string }
	| { readonly t: "node"; readonly id: string }
	| { readonly t: "call"; readonly id: string };

// Nodo de Figma («1234:5678»; una instancia suma pares: «I12:3;45:6») o llamada (UUID). Los lookarounds evitan
// partir un trozo mayor: horas con segundos, versiones, hashes
const NODE = String.raw`(?<![\w:;.-])I?\d+:\d+(?:;\d+:\d+)*(?![\w:])`;
const CALL = String.raw`(?<![\w-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w-])`;
const REF = new RegExp(`(${CALL})|(${NODE})`, "gi");

// «9:05», «11:59»: en prosa es una hora, no un nodo (1:23 es un id válido, pero solo se enlaza si va como código)
const CLOCK = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;

// Separa los ids enlazables de un texto. `inCode`: el texto viene de código en línea, donde quien escribe ya dijo
// «esto es un id» y no se descartan las horas
export function splitRefs(text: string, inCode: boolean): RefPart[] {
	const parts: RefPart[] = [];
	let last = 0;
	for (const match of text.matchAll(REF)) {
		const [found, call] = match;
		const isCall = call !== undefined;
		if (!isCall && !inCode && CLOCK.test(found)) continue;
		if (match.index > last) {
			parts.push({ t: "text", text: text.slice(last, match.index) });
		}
		parts.push(isCall ? { t: "call", id: found } : { t: "node", id: found });
		last = match.index + found.length;
	}
	if (last < text.length) parts.push({ t: "text", text: text.slice(last) });
	return parts.length === 0 ? [{ t: "text", text }] : parts;
}
