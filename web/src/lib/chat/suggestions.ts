// Preguntas del estado vacío: cada una cae en la intención de un prompt MCP del servidor (last-hour,
// errors-today, nodes-today, session); no se envía el prompt, se escribe la pregunta con palabras de persona
export const CHAT_SUGGESTIONS = [
	"¿Qué se hizo en la última hora?",
	"¿Qué errores ha habido hoy?",
	"¿Qué nodos se tocaron hoy?",
	"Resume la sesión",
] as const;
