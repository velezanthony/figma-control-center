import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOL_NAME } from "#domain/tool-names.ts";

export const PROMPT_NAME = Object.freeze({
	lastHour: "last-hour",
	errorsToday: "errors-today",
	nodesToday: "nodes-today",
	session: "session",
	attempts: "attempts",
	attemptChanges: "attempt-changes",
	costlyScreens: "costly-screens",
} as const);

// La consigna común: divulgación progresiva, para no llenar el contexto del agente
const RULES = [
	"Reglas:",
	`- Empieza por el resumen. No pidas ni vuelques listas enteras: usa los topes (limit) y fíate de «total» y «truncated».`,
	`- Pide el detalle de una llamada con ${TOOL_NAME.historyCall} solo si el resumen no basta o algo no cuadra.`,
	"- Cita cada llamada por su callId y cada nodo por su id (p. ej. 1:23); la sesión trae la URL del archivo de Figma por si hace falta enlazar.",
	"- Responde en castellano, corto, con cifras reales; si no hay datos, dilo sin inventar.",
].join("\n");

const steps = (lines: readonly string[]): string =>
	lines.map((line, i) => `${i + 1}. ${line}`).join("\n");

const lastHour = (): string =>
	[
		"Cuéntame qué se hizo con Figma en la última hora.",
		steps([
			`Llama a ${TOOL_NAME.historySummary} con preset=last_hour.`,
			`Si hay errores, llama a ${TOOL_NAME.historyErrors} con preset=last_hour.`,
			`Si se tocaron nodos, llama a ${TOOL_NAME.historyNodes} con preset=last_hour y limit=10.`,
			"Resume: cuántas llamadas, cuántas modificaron el archivo, errores y nodos más tocados.",
		]),
		RULES,
	].join("\n\n");

const errorsToday = (): string =>
	[
		"Cuéntame qué errores hubo hoy.",
		steps([
			`Llama a ${TOOL_NAME.historyErrors} con preset=today.`,
			"Para cada tipo de error di cuántas veces ocurrió, el siguiente paso recomendado y un callId de ejemplo.",
			`Solo si un error no se entiende, mira ese ejemplo con ${TOOL_NAME.historyCall}.`,
		]),
		RULES,
	].join("\n\n");

const nodesToday = (): string =>
	[
		"Cuéntame qué nodos de Figma se tocaron hoy.",
		steps([
			`Llama a ${TOOL_NAME.historyNodes} con preset=today y limit=20.`,
			"Lista cada nodo con cuántas llamadas lo tocaron y cuál fue la última (callId y herramienta).",
			`Si «truncated» es true, dilo y ofrece acotar el rango o buscar con ${TOOL_NAME.historySearch}.`,
		]),
		RULES,
	].join("\n\n");

const session = (id: string): string =>
	[
		`Cuéntame qué hizo la sesión ${id}.`,
		steps([
			`Llama a ${TOOL_NAME.historySummary} con sessionId=${id}.`,
			`Si hay errores, llama a ${TOOL_NAME.historyErrors} con sessionId=${id}.`,
			`Si tocó nodos, llama a ${TOOL_NAME.historyNodes} con sessionId=${id} y limit=10.`,
			`Si la sesión no existe, comprueba el id con ${TOOL_NAME.historySessions}.`,
		]),
		RULES,
	].join("\n\n");

const attempts = (target: string): string =>
	[
		`Cuéntame los intentos de «${target}» y qué cambió en cada uno.`,
		steps([
			`Llama a ${TOOL_NAME.historyAttempts} con target=${target} (es un texto que contiene el objetivo).`,
			"De cada intento di su número, cómo acabó, el primer error si lo hubo y la frase de «change» (qué papeles cambiaron respecto al anterior).",
			`Solo si hace falta ver las líneas de un cambio, compara dos intentos con ${TOOL_NAME.historyDiff} (from y to son los id de los intentos).`,
		]),
		RULES,
	].join("\n\n");

const attemptChanges = (target: string, a: string, b: string): string =>
	[
		`Dime qué cambió entre el intento ${a} y el intento ${b} de «${target}».`,
		steps([
			`Llama a ${TOOL_NAME.historyAttempts} con target=${target} y busca los id de los intentos con n=${a} y n=${b} (los dos del mismo objetivo).`,
			`Llama a ${TOOL_NAME.historyDiff} con from=<id del intento ${a}> y to=<id del intento ${b}>.`,
			"Cuenta qué papeles cambiaron, cuántas líneas y, del diff, qué se tocó en concreto; si «truncated» es true, lee el resto del fichero de «file».",
		]),
		RULES,
	].join("\n\n");

const costlyScreens = (): string =>
	[
		"Dime qué objetivos costaron más intentos en la última semana.",
		steps([
			`Llama a ${TOOL_NAME.historyAttempts} sin target y con since = hoy menos 7 días (fecha ISO 8601) y limit=10: salen los más intentados primero.`,
			"Lista cada objetivo con su número de intentos, cómo acabó el último y cuándo.",
			`Del que más intentos tenga, mira con ${TOOL_NAME.historyAttempts} y target qué se fue cambiando en cada intento.`,
		]),
		RULES,
	].join("\n\n");

const asPrompt = (text: string) => ({
	messages: [
		{ role: "user" as const, content: { type: "text" as const, text } },
	],
});

// En Claude Code salen como comandos «/mcp__<servidor>__<nombre>»
export function registerHistoryPrompts(server: McpServer): void {
	server.registerPrompt(
		PROMPT_NAME.lastHour,
		{
			title: "Qué se hizo en la última hora",
			description:
				"Resume la actividad de la última hora: llamadas, errores y nodos tocados, con datos reales del histórico.",
		},
		() => asPrompt(lastHour()),
	);
	server.registerPrompt(
		PROMPT_NAME.errorsToday,
		{
			title: "Errores de hoy",
			description:
				"Agrupa los errores de hoy por tipo, con su siguiente paso y una llamada de ejemplo de cada uno.",
		},
		() => asPrompt(errorsToday()),
	);
	server.registerPrompt(
		PROMPT_NAME.nodesToday,
		{
			title: "Nodos tocados hoy",
			description:
				"Lista los nodos de Figma tocados hoy, cuántas veces y por qué llamada.",
		},
		() => asPrompt(nodesToday()),
	);
	server.registerPrompt(
		PROMPT_NAME.session,
		{
			title: "Qué hizo una sesión",
			description:
				"Resume lo que hizo una sesión concreta del servidor: llamadas, errores y nodos tocados.",
			argsSchema: {
				id: z
					.string()
					.min(1)
					.describe("Id de la sesión (de figma_history_sessions)."),
			},
		},
		({ id }) => asPrompt(session(id)),
	);
	server.registerPrompt(
		PROMPT_NAME.attempts,
		{
			title: "Intentos de un objetivo",
			description:
				"Cuenta los intentos de un script, una pantalla o un paso del kit y qué papeles cambiaron en cada uno.",
			argsSchema: {
				target: z
					.string()
					.min(1)
					.describe(
						"Texto que contiene el objetivo: la ruta del script o la clave de la pantalla (p. ej. home).",
					),
			},
		},
		({ target }) => asPrompt(attempts(target)),
	);
	server.registerPrompt(
		PROMPT_NAME.attemptChanges,
		{
			title: "Qué cambió entre dos intentos",
			description:
				"Compara dos intentos de un mismo objetivo por su número y cuenta qué cambió, con las líneas.",
			argsSchema: {
				target: z
					.string()
					.min(1)
					.describe("Texto que contiene el objetivo (p. ej. home)."),
				a: z.string().min(1).describe("Número del intento de partida (n)."),
				b: z
					.string()
					.min(1)
					.describe("Número del intento con el que se compara (n)."),
			},
		},
		({ target, a, b }) => asPrompt(attemptChanges(target, a, b)),
	);
	server.registerPrompt(
		PROMPT_NAME.costlyScreens,
		{
			title: "Objetivos que más intentos costaron",
			description:
				"Lista los objetivos con más intentos en la última semana, cómo acabó cada uno y qué se fue cambiando.",
		},
		() => asPrompt(costlyScreens()),
	);
}
