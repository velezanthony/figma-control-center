// El id estable de un nodo de capture@1: los primeros 8 hexadecimales del sha256 de su
// `path`. Puro: el dominio no importa node:crypto, así que el sha256 (FIPS 180-4) va aquí, sobre los bytes UTF-8.

export const NODE_ID_HEX = 8;

const K = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const H0 = [
	0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
	0x1f83d9ab, 0x5be0cd19,
] as const;

function utf8(text: string): number[] {
	const out: number[] = [];
	for (const ch of text) {
		const c = ch.codePointAt(0) ?? 0;
		if (c < 0x80) out.push(c);
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
		else if (c < 0x10000)
			out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
		else
			out.push(
				0xf0 | (c >> 18),
				0x80 | ((c >> 12) & 0x3f),
				0x80 | ((c >> 6) & 0x3f),
				0x80 | (c & 0x3f),
			);
	}
	return out;
}

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export function sha256Hex(text: string): string {
	const bytes = utf8(text);
	const bitLength = bytes.length * 8;
	bytes.push(0x80);
	while (bytes.length % 64 !== 56) bytes.push(0);
	const high = Math.floor(bitLength / 0x100000000);
	for (const word of [high, bitLength >>> 0])
		bytes.push(
			(word >>> 24) & 0xff,
			(word >>> 16) & 0xff,
			(word >>> 8) & 0xff,
			word & 0xff,
		);
	const h: number[] = [...H0];
	const w = new Array<number>(64).fill(0);
	for (let block = 0; block < bytes.length; block += 64) {
		for (let i = 0; i < 16; i++) {
			const at = block + i * 4;
			w[i] =
				(((bytes[at] ?? 0) << 24) |
					((bytes[at + 1] ?? 0) << 16) |
					((bytes[at + 2] ?? 0) << 8) |
					(bytes[at + 3] ?? 0)) >>>
				0;
		}
		for (let i = 16; i < 64; i++) {
			const a = w[i - 15] ?? 0;
			const b = w[i - 2] ?? 0;
			const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
			const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
			w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, hh] = h as [
			number,
			number,
			number,
			number,
			number,
			number,
			number,
			number,
		];
		for (let i = 0; i < 64; i++) {
			const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (hh + s1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
			const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (s0 + maj) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}
		const next = [a, b, c, d, e, f, g, hh];
		for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (next[i] ?? 0)) >>> 0;
	}
	return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

export const nodeId = (path: string): string =>
	sha256Hex(path).slice(0, NODE_ID_HEX);

// Pone a cada nodo de un árbol capturado (con `path`, sin `id`) el id de su ruta. Lo que no es un nodo con ruta se
// deja tal cual: el esquema de capture@1 lo rechazará después
export function withIds(nodes: readonly unknown[]): unknown[] {
	return nodes.map((node) => {
		if (node === null || typeof node !== "object") return node;
		const n = node as { readonly path?: unknown; readonly kids?: unknown };
		if (typeof n.path !== "string") return node;
		return {
			...node,
			id: nodeId(n.path),
			...(Array.isArray(n.kids) && { kids: withIds(n.kids) }),
		};
	});
}
