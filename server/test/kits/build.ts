// Empaqueta los kits que corren en el navegador (kits/<kit>/index.ts → kits/dist/<kit>-kit.js; capture y figma) con esbuild. `npm run
// build:kit` escribe el fichero versionado; el test del empaquetado (kits/capture/pure/bundle.test.ts) construye en
// memoria con las MISMAS opciones y exige que coincida, así el servidor nunca lee un kit que no corresponde a sus fuentes.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BuildOptions, build } from "esbuild";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const CAPTURE_KIT_BUNDLE = resolve(
	REPO_ROOT,
	"kits/dist/capture-kit.js",
);

export const FIGMA_KIT_BUNDLE = resolve(REPO_ROOT, "kits/dist/figma-kit.js");

export const CAPTURE_KIT_BUILD: BuildOptions = {
	entryPoints: [resolve(REPO_ROOT, "kits/capture/index.ts")],
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "es2022",
	charset: "utf8",
	legalComments: "none",
	write: false,
};

export async function bundleCaptureKit(): Promise<string> {
	const out = await build(CAPTURE_KIT_BUILD);
	const file = out.outputFiles?.[0];
	if (file === undefined) throw new Error("esbuild no devolvió el kit");
	return file.text;
}

// El kit de Figma lleva sourceURL: un error dentro de él sale con ese nombre y no se confunde con el código del paso
export const FIGMA_KIT_BUILD: BuildOptions = {
	...CAPTURE_KIT_BUILD,
	entryPoints: [resolve(REPO_ROOT, "kits/figma/index.ts")],
	footer: { js: "//# sourceURL=figma-kit@1.js" },
};

export async function bundleFigmaKit(): Promise<string> {
	const out = await build(FIGMA_KIT_BUILD);
	const file = out.outputFiles?.[0];
	if (file === undefined) throw new Error("esbuild no devolvió el kit");
	return file.text;
}

if (import.meta.main) {
	writeFileSync(CAPTURE_KIT_BUNDLE, await bundleCaptureKit());
	process.stderr.write(`${CAPTURE_KIT_BUNDLE}\n`);
	writeFileSync(FIGMA_KIT_BUNDLE, await bundleFigmaKit());
	process.stderr.write(`${FIGMA_KIT_BUNDLE}\n`);
}
