// El kit de Figma empaquetado (kits/dist/figma-kit.js) y las expresiones con que el servidor pregunta a la pestaña qué
// kit tiene y lo instala. El servidor solo lee el fichero y lo manda como texto.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIGMA_KIT } from "#domain/step.ts";
import { FIGMA_KIT_GLOBAL, FIGMA_KIT_SHA_GLOBAL } from "./protocol.ts";

export const FIGMA_KIT_BUNDLE_PATH = resolve(
	import.meta.dirname,
	"../../../../kits/dist/figma-kit.js",
);

export type FigmaKitBundle = {
	readonly version: string;
	readonly sha256: string;
	readonly source: string;
};

export function readFigmaKitBundle(
	path: string = FIGMA_KIT_BUNDLE_PATH,
): FigmaKitBundle {
	const source = readFileSync(path, "utf8");
	return {
		version: FIGMA_KIT,
		sha256: createHash("sha256").update(source).digest("hex"),
		source,
	};
}

// Versión y hash del kit que tiene la pestaña (`null` si no hay ninguno). Solo lectura
export const KIT_PROBE_EXPRESSION = `(() => {
	const kit = globalThis.${FIGMA_KIT_GLOBAL};
	return kit ? { version: kit.version ?? null, sha256: kit.sha256 ?? null } : null;
})()`;

// El hash se deja en un global ANTES de evaluar el empaquetado: el kit lo lee al crearse (no puede calcular el suyo)
export const kitInstallExpression = (bundle: FigmaKitBundle): string =>
	`globalThis.${FIGMA_KIT_SHA_GLOBAL} = ${JSON.stringify(bundle.sha256)};\n${bundle.source}`;

export const hasKit = (
	probe: unknown,
	bundle: Pick<FigmaKitBundle, "version" | "sha256">,
): boolean => {
	if (typeof probe !== "object" || probe === null) return false;
	const found = probe as { version?: unknown; sha256?: unknown };
	return found.version === bundle.version && found.sha256 === bundle.sha256;
};
