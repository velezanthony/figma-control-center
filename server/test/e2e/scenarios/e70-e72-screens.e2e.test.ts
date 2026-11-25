// E70 a E72 de la captura a Figma: `kit/build-screen@1` en un lote, `figma_build
// { areas }` con pantallas y la validación previa sin Figma. Servidor MCP real + SQLite con `example-mini` (su web, su Chrome de
// captura y su map.json), con el simulador de Figma como pestaña: el simulador reconoce el código fijo del paso y contesta desde
// el plan que recibe como asset. Sin Figma, sin el proyecto consumidor y sin el 9222.
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
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
const readJson = async (file: string) =>
	JSON.parse(await readFile(file, "utf8")) as Json;

const SCREEN_STEP = {
	use: "kit/build-screen@1",
	screen: "inicio",
	area: "Panel",
};
const EXPRESSION = /kit\.steps\.buildScreen\(params, assets, recognize\)/;
const sentExpressions = (e: CaptureEnvironment) =>
	(e.env.simulator?.expressions ?? []).filter((x) => EXPRESSION.test(x));

// El plan que recibió la pestaña: el asset `plan` va en base64 dentro del código enviado
const planOf = (expression: string): Json => {
	const b64 = /"plan":figma\.base64Decode\("([^"]*)"\)/.exec(expression)?.[1];
	assert.ok(b64, "el asset `plan` no está en el código enviado");
	return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Json;
};

async function start(extraEnv: Record<string, string> = {}) {
	c = await startCaptureEnvironment({ extraEnv, projectIsScriptsRoot: true });
	return c;
}

async function capture(e: CaptureEnvironment) {
	const r = await e.claude.callTool(TOOL_NAME.capture, { screens: ["inicio"] });
	assert.equal(r.isError, false, r.text);
}

async function build(e: CaptureEnvironment, args: Record<string, unknown>) {
	const started = await e.claude.callTool(TOOL_NAME.build, args);
	if (started.isError || started.out["jobId"] === undefined) return { started };
	const end = await e.claude.waitJob(String(started.out["jobId"]));
	return { started, end };
}

describe("E70 · build-screen en un lote", () => {
	it("tras capturar, el paso corre con el plan y la imagen como assets, deja el plan en screen-plans/ y su etiqueta sale en el progreso y en el histórico", async () => {
		const e = await start();
		await capture(e);
		const { started, end } = await build(e, { steps: [SCREEN_STEP] });
		assert.equal(started.isError, false, started.text);
		assert.equal(
			(started.out["steps"] as { file: string }[])[0]?.file,
			"kit/build-screen@1 · inicio",
		);
		assert.equal(end?.out["status"], "done", end?.text ?? "");

		const [expression] = sentExpressions(e);
		const recognize = await readFile(
			join(projectOf(e), "recognize.js"),
			"utf8",
		);
		assert.ok(
			expression?.includes(kitStepCode("kit/build-screen@1", { recognize })),
		);
		const plan = planOf(expression ?? "");
		assert.equal(plan["contract"], "screen@1");
		assert.equal(plan["screen"], "inicio");
		assert.ok(plan["root"].length > 0);
		assert.deepEqual(plan["target"].page, {
			name: "tmp Inicio",
			key: "fcc:screen-page:inicio",
			after: "Panel",
		});
		// una imagen por cada `ref` del plan, como asset con su sha256
		for (const sha of Object.keys(plan["images"])) {
			assert.ok(expression?.includes(`"${sha}":figma.base64Decode(`), sha);
		}

		const days = await readdir(join(e.outputDir, "screen-plans"));
		assert.equal(days.length, 1);
		const files = await readdir(
			join(e.outputDir, "screen-plans", days[0] ?? ""),
		);
		assert.equal(files.length, 1);
		assert.match(files[0] ?? "", /^inicio_\d{6}\.json$/);
		const stored = await readJson(
			join(e.outputDir, "screen-plans", days[0] ?? "", files[0] ?? ""),
		);
		assert.deepEqual(
			stored["sources"].capture.sha256,
			plan["sources"].capture.sha256,
		);

		const calls = e.env.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const call = await e.claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[0]?.call_id,
		});
		assert.equal(
			(call.out["steps"] as { file: string }[])[0]?.file,
			"kit/build-screen@1 · inicio",
		);
		const attempts = await e.claude.callTool(TOOL_NAME.historyAttempts, {
			target: "kit/build-screen@1 · inicio",
		});
		const [first] = attempts.out["items"] as {
			kind: string;
			scripts: { role: string }[];
		}[];
		assert.equal(first?.kind, "build_step");
		assert.deepEqual(first?.scripts.map((s) => s.role).sort(), [
			"kit",
			"map",
			"params",
			"plan",
			"recognize",
			"step",
		]);
	});

	it("capturar otra vez da «cambió plan»; cambiar map.json, «cambió map y plan»", async () => {
		const e = await start();
		await capture(e);
		await build(e, { steps: [SCREEN_STEP] });
		await capture(e);
		await build(e, { steps: [SCREEN_STEP] });
		const mapFile = join(projectOf(e), "map.json");
		const map = await readJson(mapFile);
		map["fonts"].default = "Otra Sans";
		await writeFile(mapFile, JSON.stringify(map));
		await build(e, { steps: [SCREEN_STEP] });

		const list = await e.claude.callTool(TOOL_NAME.historyAttempts, {
			target: "kit/build-screen@1 · inicio",
		});
		const items = list.out["items"] as {
			n: number;
			changed: string[] | null;
			change: string;
		}[];
		assert.deepEqual(
			items.map((i) => i.n),
			[1, 2, 3],
		);
		assert.equal(items[0]?.changed, null);
		assert.deepEqual(items[1]?.changed, ["plan"]);
		assert.match(items[1]?.change ?? "", /cambió plan/);
		assert.deepEqual(items[2]?.changed, ["map", "plan"]);
		assert.match(items[2]?.change ?? "", /cambiaron map y plan/);
	});
});

describe("E71 · figma_build { areas } con pantallas", () => {
	it("antepone build-screen a la pantalla con captura y no a la otra; es el mismo plan que el manifiesto escrito a mano", async () => {
		const e = await start();
		await capture(e);
		const byAreas = await build(e, { areas: ["Panel"] });
		assert.equal(byAreas.started.isError, false, byAreas.started.text);
		const labels = (byAreas.started.out["steps"] as { file: string }[]).map(
			(s) => s.file,
		);
		assert.equal(labels[0], "kit/build-screen@1 · inicio");
		assert.ok(!labels.includes("kit/build-screen@1 · privado"));
		assert.equal(labels[1], "kit/place@1 · Panel");
		assert.equal(byAreas.end?.out["status"], "done", byAreas.end?.text ?? "");

		const byHand = await build(e, {
			steps: [
				SCREEN_STEP,
				{ use: "kit/place@1", area: "Panel" },
				{ use: "kit/share@1", area: "Panel" },
				{ use: "kit/links@1", area: "Panel" },
				{ use: "kit/fill-image@1", area: "Panel" },
			],
		});
		assert.deepEqual(
			(byHand.started.out["steps"] as { file: string }[]).map((s) => s.file),
			labels,
		);
	});
});

describe("E72 · validación previa de build-screen", () => {
	// La captura previa también es un job: se comparan los jobs de antes y de después del lote rechazado
	const jobsOf = (e: CaptureEnvironment) =>
		e.env.rows("SELECT 1 FROM jobs").length;
	const nothingSent = (e: CaptureEnvironment, jobsBefore: number) => {
		assert.equal(sentExpressions(e).length, 0, "no se envió nada a la pestaña");
		assert.equal(jobsOf(e), jobsBefore, "no hay job nuevo");
	};

	it("sin `map` en project@1: ProjectConfigError con el campo `map`, sin job ni envío", async () => {
		const e = await start();
		await capture(e);
		const file = join(projectOf(e), "figma-control-center.json");
		const config = await readJson(file);
		delete config["map"];
		await writeFile(file, JSON.stringify(config));
		const before = jobsOf(e);
		const { started } = await build(e, { steps: [SCREEN_STEP] });
		assert.equal(started.isError, true);
		assert.match(started.text, /map/);
		assert.equal(started.out["jobId"] ?? null, null);
		nothingSent(e, before);
	});

	it("un map.json roto: ContractError con el puntero JSON, sin job ni envío", async () => {
		const e = await start();
		await capture(e);
		const mapFile = join(projectOf(e), "map.json");
		const map = await readJson(mapFile);
		map["tokens"].classToVariable[0].from = "(";
		await writeFile(mapFile, JSON.stringify(map));
		const before = jobsOf(e);
		const { started } = await build(e, { steps: [SCREEN_STEP] });
		assert.equal(started.isError, true);
		assert.match(started.text, /\/tokens\/classToVariable\/0\/from/);
		nothingSent(e, before);
	});

	it("una pantalla sin captura, o una variante que no existe: error de uso que dice qué hacer, sin job ni envío", async () => {
		const e = await start();
		const noCapture = await build(e, { steps: [SCREEN_STEP] });
		assert.equal(noCapture.started.isError, true);
		assert.match(noCapture.started.text, /figma_capture/);
		await capture(e);
		const before = jobsOf(e);
		const badVariant = await build(e, {
			steps: [{ ...SCREEN_STEP, variant: 9 }],
		});
		assert.equal(badVariant.started.isError, true);
		assert.match(badVariant.started.text, /variante 9/);
		const notInArea = await build(e, {
			steps: [{ use: "kit/build-screen@1", screen: "privado", area: "Panel" }],
		});
		assert.equal(notInArea.started.isError, true);
		nothingSent(e, before);
		// nada se quedó reservado: un lote correcto sale
		const ok = await build(e, { steps: [SCREEN_STEP] });
		assert.equal(ok.end?.out["status"], "done", ok.end?.text ?? "");
	});

	it("assets sobre el tope: el error con el tope, sin job ni envío", async () => {
		const e = await start({ FCC_MAX_ASSET_BYTES: "200" });
		await capture(e);
		const before = jobsOf(e);
		const { started } = await build(e, { steps: [SCREEN_STEP] });
		assert.equal(started.isError, true);
		assert.match(started.text, /tope|200/);
		nothingSent(e, before);
	});
});
