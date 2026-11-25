// Regla única de la URL de un archivo de Figma: la usan el .env, el registro y el panel. Tipos puros, sin imports
// (el dominio no tiene ni `URL`).

// https://www.figma.com/design/<clave> o /file/<clave>, seguido de nada, «/», «?» o «#»
const FILE_URL =
	/^https:\/\/www\.figma\.com\/(?:design|file)\/([A-Za-z0-9]+)(?:[/?#]|$)/;
const LOOKS_LIKE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+$/;

// La clave del archivo (`fileKey`) de la URL de una pestaña o de la configurada, o null si no es de un archivo de
// Figma. Admite query, fragmento y cualquier nombre tras la clave.
export function figmaFileKey(url: string): string | null {
	return FILE_URL.exec(url)?.[1] ?? null;
}

// Por qué una URL no vale como archivo configurado, o null si vale. La configurada no lleva query ni fragmento.
export function figmaFileUrlProblem(url: string): string | null {
	if (!LOOKS_LIKE_URL.test(url)) return "no es una URL";
	if (url.includes("?") || url.includes("#")) {
		return "la URL no puede llevar query string ni fragmento: quita la parte desde «?» (o «#»)";
	}
	if (figmaFileKey(url) === null) {
		return "la URL debe ser un archivo de Figma con su clave (https://www.figma.com/design/<clave> o /file/<clave>)";
	}
	return null;
}
