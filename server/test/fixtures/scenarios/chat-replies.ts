// Respuestas de ejemplo del Claude simulado (Markdown). Construidas a mano para cubrir lo que el panel pinta:
// negrita, código, listas con viñetas y numeradas (anidadas), un id de nodo y un id de llamada. No son salidas reales.
export const MARKDOWN_REPLY = [
	"Hoy hubo **2 errores** de 2 tipos:",
	"",
	"- `ScriptError` (1): fallo del propio script",
	"  - en la llamada `3f9a1c2e-aaaa-4bbb-8ccc-0123456789ab`",
	"- `Timeout` (1): el script no respondió",
	"",
	"Pasos para arreglarlo:",
	"",
	"1. Revisa el nodo `10:1`",
	"2. Vuelve a lanzar el script",
	"",
	"Nada más que contar.",
].join("\n");

// Lo que contiene el Markdown y se comprueba que sale pintado
export const MARKDOWN_REPLY_FACTS = Object.freeze({
	bold: "2 errores",
	bullets: 3,
	numbered: 2,
	nodeId: "10:1",
} as const);
