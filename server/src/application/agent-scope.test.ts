import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { agentScopeProblem, chatAgentToolProblem } from "./agent-scope.ts";

describe("agentScopeProblem", () => {
	it("un agente de chat con exactamente un proyecto en alcance vale", () => {
		assert.equal(agentScopeProblem(true, { kind: "ids", ids: ["1"] }), null);
	});

	it("un agente de chat con alcance «any», de varios proyectos o de ninguno no vale, y lo dice", () => {
		for (const scope of [
			{ kind: "any" } as const,
			{ kind: "ids", ids: ["1", "2"] } as const,
			{ kind: "ids", ids: [] } as const,
		]) {
			assert.match(
				agentScopeProblem(true, scope) ?? "",
				/esta sesión de agente no tiene proyecto/i,
				JSON.stringify(scope),
			);
		}
	});

	it("una sesión normal (sin la marca de agente) no tiene esta regla", () => {
		assert.equal(agentScopeProblem(false, { kind: "any" }), null);
	});
});

describe("chatAgentToolProblem", () => {
	it("un agente de chat no ejecuta scripts, lotes, cancelaciones ni capturas, y dice que se hace desde Claude Code en el proyecto", () => {
		for (const tool of [
			TOOL_NAME.runScript,
			TOOL_NAME.build,
			TOOL_NAME.cancelJob,
			TOOL_NAME.capture,
		]) {
			const problem = chatAgentToolProblem(true, tool) ?? "";
			assert.match(problem, /solo consulta/, tool);
			assert.match(problem, /desde Claude Code/, tool);
		}
	});

	it("un agente de chat sí lee, consulta el histórico y responde en el chat", () => {
		for (const tool of [
			TOOL_NAME.status,
			TOOL_NAME.metadata,
			TOOL_NAME.historySummary,
			TOOL_NAME.chatReply,
		]) {
			assert.equal(chatAgentToolProblem(true, tool), null, tool);
		}
	});

	it("una sesión normal usa todas las herramientas", () => {
		assert.equal(chatAgentToolProblem(false, TOOL_NAME.runScript), null);
	});
});
