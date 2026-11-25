import { z } from "zod";
import {
	type FigmaError,
	kitScriptError,
	nodeNotFound,
	scriptError,
} from "#domain/figma-error.ts";
import {
	JS_SYNTAX_ERROR_CLASS,
	KIT_FAIL_MARKER,
	NODE_NOT_FOUND_MARKER,
} from "./protocol.ts";

export type ExceptionDetails = {
	readonly text: string;
	readonly lineNumber?: number | undefined;
	readonly exception?:
		| {
				readonly className?: string | undefined;
				readonly description?: string | undefined;
		  }
		| undefined;
};

// Primer marco del código evaluado: «<anonymous>:LÍNEA:COLUMNA» (líneas desde 1).
// Los marcos de Figma (su bundle) van antes cuando el error salta dentro de su API: no sirven.
const SCRIPT_FRAME_POSITION = /<anonymous>:(\d+):\d+/;

const NODE_NOT_FOUND_ID = new RegExp(`${NODE_NOT_FOUND_MARKER}(\\S+)`);

const KitFailSchema = z.object({
	code: z.string(),
	message: z.string(),
	next: z.string(),
});

// Lo que `kit.fail` metió tras la marca (JSON en la misma línea); `undefined` si no hay marca o no se lee
function kitFailure(description: string) {
	const at = description.indexOf(KIT_FAIL_MARKER);
	if (at === -1) return undefined;
	const json = description.slice(at + KIT_FAIL_MARKER.length).split("\n")[0];
	try {
		const parsed = KitFailSchema.safeParse(JSON.parse(json ?? ""));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

export function toScriptError(
	details: ExceptionDetails,
	lineOffset: number,
): FigmaError {
	const description = details.exception?.description ?? details.text;
	const isSyntaxError =
		details.exception?.className === JS_SYNTAX_ERROR_CLASS ||
		description.startsWith(JS_SYNTAX_ERROR_CLASS);
	const missing = description.match(NODE_NOT_FOUND_ID)?.[1];
	if (missing !== undefined) return nodeNotFound(missing);
	const fromStack = SCRIPT_FRAME_POSITION.exec(description)?.[1];
	// Sintaxis: solo hay lineNumber de CDP (desde 0). Ejecución: solo la pila (desde 1); CDP da lineNumber 0 siempre
	const evaluatedLine = isSyntaxError
		? details.lineNumber === undefined
			? null
			: details.lineNumber + 1
		: fromStack === undefined
			? null
			: Number(fromStack);
	const line =
		evaluatedLine === null || evaluatedLine - lineOffset < 1
			? null
			: evaluatedLine - lineOffset;
	const failure = kitFailure(description);
	if (failure !== undefined) {
		return kitScriptError(failure.code, failure.message, failure.next, line);
	}
	const firstLine = description.split("\n")[0] ?? description;
	return scriptError(
		line === null ? firstLine : `${firstLine} (línea ${line})`,
		line,
		isSyntaxError,
	);
}
