import {
	SCRIPT_FORMAT,
	type ScriptToRun,
} from "#application/ports/figma-gateway.ts";
import { FIGMA_KIT_GLOBAL } from "./protocol.ts";

export type WrappedScript = {
	readonly expression: string;
	// Líneas que el envoltorio añade antes del código del usuario
	readonly lineOffset: number;
};

const TRAILING_SEMICOLONS = /[;\s]+$/;

// `params` se embebe como valor JSON; si no hay, llega como `undefined`.
const paramsExpr = (params: unknown): string =>
	JSON.stringify(params) ?? "undefined";

// Cada asset viaja como base64 y se decodifica en la pestaña con figma.base64Decode → Uint8Array.
const assetsExpr = (assets: ScriptToRun["assets"]): string => {
	const entries = Object.entries(assets ?? {}).map(
		([name, bytes]) =>
			`${JSON.stringify(name)}:figma.base64Decode(${JSON.stringify(Buffer.from(bytes).toString("base64"))})`,
	);
	return `{${entries.join(",")}}`;
};

// `kit` es el kit de Figma instalado en la pestaña (`undefined` si no se instaló: scripts internos).
const KIT_EXPR = `globalThis.${FIGMA_KIT_GLOBAL}`;

// `body`: cuerpo de una función async (como use_figma). `function`: expresión `async () => {…}` completa.
// params, assets y kit se inyectan en la MISMA primera línea (body) o en la llamada (function) para no mover el lineOffset.
// Un `body` que declare su propio `kit` (o `params`, o `assets`) deja de compilar.
export function wrapScript(script: ScriptToRun): WrappedScript {
	const params = paramsExpr(script.params);
	const assets = assetsExpr(script.assets);
	if (script.format === SCRIPT_FORMAT.body) {
		return {
			expression: `(async () => {const params = ${params};const assets = ${assets};const kit = ${KIT_EXPR};\n${script.code}\n})()`,
			lineOffset: 1,
		};
	}
	const fn = script.code.replace(TRAILING_SEMICOLONS, "");
	return {
		expression: `(${fn}\n)(${params}, ${assets}, ${KIT_EXPR})`,
		lineOffset: 0,
	};
}
