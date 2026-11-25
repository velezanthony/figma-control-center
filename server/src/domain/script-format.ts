// Cómo interpreta el servidor el código de un script: una expresión que se invoca (`function`) o un
// cuerpo suelto (`body`). Vocabulario del dominio: lo comparten el puerto FigmaGateway y los pasos de un lote.
export const SCRIPT_FORMAT = Object.freeze({
	body: "body",
	function: "function",
} as const);
export type ScriptFormat = (typeof SCRIPT_FORMAT)[keyof typeof SCRIPT_FORMAT];
