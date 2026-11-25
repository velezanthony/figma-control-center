// E62 kit inyectado: figma_run_script en `body` y `function` recibe `kit`; el kit se instala una
// vez por pestaña (la segunda llamada no lo manda) y otra vez tras recargar la pestaña simulada; figma_metadata no lo
// instala; un script viejo, que no usa `kit`, funciona igual. Servidor MCP real, con el simulador de Figma como Chrome.
// El simulador no ejecuta JavaScript: se comprueba qué se manda a la pestaña y cuándo.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { KIT_PROBE_EXPRESSION } from "#adapters/cdp/figma-kit.ts";
import {
	FIGMA_KIT_GLOBAL,
	FIGMA_KIT_SHA_GLOBAL,
} from "#adapters/cdp/protocol.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

const sent = () => env.simulator?.expressions ?? [];
const installs = () =>
	sent().filter((e) => e.startsWith(`globalThis.${FIGMA_KIT_SHA_GLOBAL} =`));
const probes = () => sent().filter((e) => e === KIT_PROBE_EXPRESSION);
const scripts = () =>
	sent().filter((e) => e.includes(`@scenario: ${SCENARIOS.writeCreated.id}`));

const runFile = (claude: Awaited<ReturnType<Environment["startClaude"]>>) =>
	claude.callTool(TOOL_NAME.runScript, {
		file: scenarioPath(SCENARIOS.writeCreated.script),
		format: SCENARIOS.writeCreated.format,
	});

describe("E62 · kit de Figma inyectado", () => {
	it("un script en formato body recibe `kit` como constante de su primera línea, sin mover las líneas", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const r = await runFile(claude);
		assert.equal(r.isError, false);
		const [expression] = scripts();
		const lines = expression?.split("\n") ?? [];
		assert.match(
			lines[0] ?? "",
			new RegExp(`const kit = globalThis\\.${FIGMA_KIT_GLOBAL};$`),
		);
		assert.match(lines[1] ?? "", /@scenario: write-created/);
	});

	it("un script en formato function lo recibe como tercer argumento", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const r = await claude.callTool(TOOL_NAME.runScript, {
			code: "// @scenario: write-created\nasync (params, assets, kit) => kit.version",
			format: "function",
		});
		assert.equal(r.isError, false);
		const [expression] = scripts();
		assert.match(
			expression ?? "",
			new RegExp(`, globalThis\\.${FIGMA_KIT_GLOBAL}\\)$`),
		);
	});

	it("el kit se instala una vez: la segunda llamada solo pregunta por su versión y su hash", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		await runFile(claude);
		assert.equal(installs().length, 1);
		await runFile(claude);
		await runFile(claude);
		assert.equal(installs().length, 1, "no se vuelve a mandar");
		assert.equal(
			probes().length,
			4,
			"dos preguntas en la primera, una en cada otra",
		);
		assert.equal(scripts().length, 3);
	});

	it("tras recargar la pestaña (el kit desaparece) se instala otra vez", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		await runFile(claude);
		env.simulator?.reloadTab();
		const again = await runFile(claude);
		assert.equal(again.isError, false);
		assert.equal(installs().length, 2);
	});

	it("figma_metadata no pregunta ni instala el kit: es un script interno", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const meta = await claude.callTool(TOOL_NAME.metadata, {});
		assert.equal(meta.isError, false);
		assert.deepEqual([installs().length, probes().length], [0, 0]);
	});

	it("un lote también lo instala (una vez) antes de su primer paso", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				{ file: scenarioPath(SCENARIOS.buildStepOkA.script), format: "body" },
				{ file: scenarioPath(SCENARIOS.buildStepOkB.script), format: "body" },
			],
		});
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "done");
		assert.equal(installs().length, 1);
	});
});
