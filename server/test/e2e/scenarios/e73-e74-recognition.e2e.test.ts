// E73 y E74 del reconocimiento de componentes: `recognize.js` del proyecto viaja
// dentro del código del paso, el intento lo guarda y dice si cambió, y el informe del paso con sus coincidencias llega al
// histórico; y el camino entero de `example-mini` (captura → build-screen → place → links) sin ningún dato de una web real. Servidor MCP
// real + SQLite, con el simulador de Figma como pestaña (no reconoce nada: informa de una coincidencia por regla y por huella).
// Sin Figma, sin el proyecto consumidor y sin el 9222.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { kitStepCode } from "#domain/step.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type CaptureEnvironment,
	startCaptureEnvironment,
} from "../../harness/capture-environment.ts";

let c: CaptureEnvironment | undefined;
afterEach(async () => {
	await c?.stop();
	c = undefined;
});

const projectOf = (e: CaptureEnvironment) =>
	e.env.projects[0]?.projectDir ?? "";

type Json = Record<string, any>;

const SCREEN_STEP = {
	use: "kit/build-screen@1",
	screen: "inicio",
	area: "Panel",
};
const EXPRESSION = /kit\.steps\.buildScreen\(params, assets, recognize\)/;
const sentExpressions = (e: CaptureEnvironment) =>
	(e.env.simulator?.expressions ?? []).filter((x) => EXPRESSION.test(x));

const planOf = (expression: string): Json => {
	const b64 = /"plan":figma\.base64Decode\("([^"]*)"\)/.exec(expression)?.[1];
	assert.ok(b64, "el asset `plan` no está en el código enviado");
	return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Json;
};

async function start() {
	c = await startCaptureEnvironment({ projectIsScriptsRoot: true });
	const r = await c.claude.callTool(TOOL_NAME.capture, { screens: ["inicio"] });
	assert.equal(r.isError, false, r.text);
	return c;
}

async function build(e: CaptureEnvironment, args: Record<string, unknown>) {
	const started = await e.claude.callTool(TOOL_NAME.build, args);
	assert.equal(started.isError, false, started.text);
	const end = await e.claude.waitJob(String(started.out["jobId"]));
	return { started, end };
}

describe("E73 · reconocimiento", () => {
	it("recognize.js va dentro del código del paso y el plan lleva sus reglas, sus huellas y su hash", async () => {
		const e = await start();
		const { end } = await build(e, { steps: [SCREEN_STEP] });
		assert.equal(end.out["status"], "done", end.text);
		const source = await readFile(join(projectOf(e), "recognize.js"), "utf8");
		const [expression] = sentExpressions(e);
		assert.ok(
			expression?.includes(
				kitStepCode("kit/build-screen@1", { recognize: source }),
			),
		);
		const plan = planOf(expression ?? "");
		assert.deepEqual(plan["rules"], ["Boton"]);
		assert.deepEqual(Object.keys(plan["fingerprints"]), ["atomos.marca"]);
		assert.deepEqual(plan["map"].components, {
			genericClasses: ["flex", "items-\\S+"],
		});
		assert.equal(
			plan["sources"].recognize.sha256,
			createHash("sha256").update(source).digest("hex"),
		);
	});

	it("el intento guarda `recognize`; cambiarlo da «cambiaron plan y recognize» (el plan lleva su hash; `step` no cambia: el módulo es su propio papel)", async () => {
		const e = await start();
		await build(e, { steps: [SCREEN_STEP] });
		const file = join(projectOf(e), "recognize.js");
		await writeFile(file, `${await readFile(file, "utf8")}\n// otro retoque\n`);
		await build(e, { steps: [SCREEN_STEP] });
		const list = await e.claude.callTool(TOOL_NAME.historyAttempts, {
			target: "kit/build-screen@1 · inicio",
		});
		const items = list.out["items"] as {
			n: number;
			changed: string[] | null;
			change: string;
			scripts: { role: string }[];
		}[];
		assert.deepEqual(
			items.map((i) => i.n),
			[1, 2],
		);
		assert.ok(items[0]?.scripts.some((s) => s.role === "recognize"));
		assert.deepEqual(items[1]?.changed ?? null, ["plan", "recognize"]);
		assert.match(items[1]?.change ?? "", /recognize/);
	});

	it("el resultado del paso en el histórico lleva `report.matches`", async () => {
		const e = await start();
		await build(e, { steps: [SCREEN_STEP] });
		const calls = e.env.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const call = await e.claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[0]?.call_id,
			step: 0,
		});
		assert.equal(call.isError, false, call.text);
		const text = JSON.stringify(call.out);
		assert.match(text, /"matches"/);
		assert.match(text, /rule:Boton/);
		assert.match(text, /fingerprint/);
	});
});

describe("E74 · genérico", () => {
	it("example-mini recorre captura → build-screen → place → links con el reconocimiento puesto y sin ningún dato de una web real", async () => {
		const e = await start();
		const { started, end } = await build(e, { areas: ["Panel"] });
		const labels = (started.out["steps"] as { file: string }[]).map(
			(s) => s.file,
		);
		assert.deepEqual(labels.slice(0, 2), [
			"kit/build-screen@1 · inicio",
			"kit/place@1 · Panel",
		]);
		assert.ok(labels.includes("kit/links@1 · Panel"));
		assert.equal(end.out["status"], "done", end.text);
		// todo lo que se envió son datos del proyecto de ejemplo
		const sent = (e.env.simulator?.expressions ?? []).join("\n");
		assert.ok(
			!/djDebug|x-data|x-cloak|csrfmiddlewaretoken/.test(sent),
			"el código enviado nombra algo de una web real",
		);
		const [expression] = sentExpressions(e);
		assert.deepEqual(planOf(expression ?? "")["rules"], ["Boton"]);
	});
});
