// La clave de un svg: sus trazados (`d="…"`) unidos con «|». Con ella se casa cada svg
// capturado con un icono del catálogo; el plan y el kit comparan por ella.
const PATH_DATA = /\sd="([^"]+)"/g;

export function iconKey(svg: string): string {
	return [...svg.matchAll(PATH_DATA)].map((m) => m[1]).join("|");
}
