// Guarda anti-producción de las pruebas contra Figma real (make e2e-record / e2e-contract): solo se ejecutan
// contra el archivo de pruebas que el dueño configura en FIGMA_TEST_FILE_URL, identificado por su fileKey
// (la URL puede cambiar de nombre o de parámetros). Usa un archivo reservado para pruebas, nunca uno de trabajo.
import { figmaFileKey } from "#domain/figma-url.ts";

export { figmaFileKey };

// Lanza si falta FIGMA_TEST_FILE_URL o no es una URL de archivo de Figma; devuelve la URL ya validada
export function requireTestFile(configured: string | null): string {
	if (configured === null) {
		throw new Error(
			"Falta FIGMA_TEST_FILE_URL en .env: las pruebas contra Figma real solo se ejecutan contra el archivo de pruebas configurado ahí.",
		);
	}
	if (figmaFileKey(configured) === null) {
		throw new Error(
			`${configured} no es una URL de archivo de Figma: me niego a ejecutar nada contra ella.`,
		);
	}
	return configured;
}

// Lanza si `url` no es el archivo de pruebas configurado; devuelve la URL ya validada
export function assertTestingFile(
	url: string | null,
	configured: string,
): string {
	const expected = figmaFileKey(configured);
	if (url === null || expected === null || figmaFileKey(url) !== expected) {
		throw new Error(
			`${url ?? "(sin URL)"} no es el archivo de pruebas (fileKey ${expected ?? "desconocido"}): me niego a ejecutar nada contra él.`,
		);
	}
	return url;
}
