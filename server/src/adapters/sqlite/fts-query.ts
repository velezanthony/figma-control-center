// Texto libre del usuario → consulta FTS5 segura. FTS5 tiene su propia sintaxis (comillas, OR, NEAR, «:»,
// «-»…) y pasarle texto crudo la rompe: cada palabra se reduce a sus letras y cifras y se cita como frase
// (así «1:23» busca los tokens 1 y 23 seguidos, no 1 y 23 sueltos) con prefijo, y las palabras se enlazan con Y
const WORD = /[\p{L}\p{N}]+/gu;

export function toFtsQuery(text: string): string | null {
	const phrases = text
		.split(/\s+/)
		.map((word) => word.match(WORD))
		.filter((tokens): tokens is RegExpMatchArray => tokens !== null)
		.map((tokens) => `"${tokens.join(" ")}"*`);
	return phrases.length === 0 ? null : phrases.join(" ");
}
