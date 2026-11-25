import type { ProjectScope } from "#domain/config.ts";
import { CHAT_AGENT_DENIED_TOOLS } from "#domain/tool-names.ts";

// Defensa en profundidad del arnés: una sesión lanzada como agente de chat
// (FCC_CHAT_AGENT) solo trabaja con UN proyecto. Con cualquier otro alcance no atiende el chat ni toca Figma: toda
// herramienta responde este error de uso. Una sesión normal de `claude` no tiene esta regla. null si vale
export function agentScopeProblem(
	chatAgent: boolean,
	scope: ProjectScope,
): string | null {
	if (!chatAgent) return null;
	if (scope.kind === "ids" && scope.ids.length === 1) return null;
	return "Esta sesión de agente no tiene proyecto: un agente de chat trabaja con un solo proyecto. Lánzalo desde el panel con el proyecto elegido, o con `make agent PROJECT=<número>`.";
}

export const CHAT_AGENT_READ_ONLY =
	"Este agente del panel solo consulta (estado, actividad e histórico): no ejecuta scripts, lotes, cancelaciones ni capturas. Los cambios se hacen desde Claude Code dentro del proyecto, con el servidor MCP conectado.";

// El servidor repite lo que niegan el arnés y el guardián del agente de chat: aunque sus ajustes se salten, no
// cambia Figma ni captura la web. null si la herramienta vale
export function chatAgentToolProblem(
	chatAgent: boolean,
	tool: string,
): string | null {
	return chatAgent && CHAT_AGENT_DENIED_TOOLS.includes(tool)
		? CHAT_AGENT_READ_ONLY
		: null;
}
