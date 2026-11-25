// E42: una sesión con FCC_CHAT_AGENT=1 cuyo alcance no es exactamente un proyecto no
// se registra en el chat y sus herramientas responden el error de uso, aunque haya proyectos dados de alta.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { startEnvironment } from "../../harness/environment.ts";

const OTHER = {
	name: "Otro",
	projectDir: "/tmp/figma-e42-otro",
	fileUrl: "https://www.figma.com/design/OTRO42/Otro",
};

describe("E42 · agente sin proyecto único", () => {
	for (const scope of ["any", "1,2"]) {
		it(`con FCC_PROJECTS=${scope} la sesión no atiende el chat y no toca Figma`, async () => {
			const env = await startEnvironment({
				chatAgent: true,
				extraEnv: { FCC_PROJECTS: scope },
			});
			try {
				const saved = await fetch(`${env.dashboardUrl}/api/projects/save`, {
					method: "POST",
					headers: {
						Origin: env.dashboardUrl,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ entry: OTHER }),
				});
				assert.equal(saved.status, 200);
				const claude = await env.startClaude();
				for (const [tool, args] of [
					[TOOL_NAME.status, {}],
					[TOOL_NAME.runScript, { code: "return 1" }],
					[TOOL_NAME.chatReply, { chat_id: "c", text: "hola" }],
				] as const) {
					const r = await claude.callTool(tool, args);
					assert.equal(r.isError, true, tool);
					assert.match(r.text, /no tiene proyecto/, tool);
				}
				for (const project of ["1", "2"]) {
					const s = await env.api<{ items: unknown[] }>(
						`/api/chat/sessions?project=${project}`,
					);
					assert.deepEqual(s.items, [], project);
				}
			} finally {
				await env.stop();
			}
		});
	}
});
