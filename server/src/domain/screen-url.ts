// La url de una variante: la de su pantalla más su `query`, codificada como un `urlencode` (pares en el orden escrito, sin ordenar; espacio como «+»).

// encodeURIComponent deja sin escapar ! ' ( ) * que urlencode sí escapa
const encode = (text: string): string =>
	encodeURIComponent(text)
		.replace(
			/[!'()*]/g,
			(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
		)
		.replaceAll("%20", "+");

export function variantPath(
	url: string,
	query: Readonly<Record<string, string>> | undefined,
): string {
	const pairs = Object.entries(query ?? {});
	if (pairs.length === 0) return url;
	const joined = pairs.map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&");
	if (!url.includes("?")) return `${url}?${joined}`;
	return url.endsWith("?") || url.endsWith("&")
		? `${url}${joined}`
		: `${url}&${joined}`;
}
