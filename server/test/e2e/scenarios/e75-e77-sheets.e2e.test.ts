// E75 a E77 de las hojas de componentes: capturar un componente por query y
// viewport, `kit/build-component@1` en un manifiesto y su validación previa sin Figma. Servidor MCP real + SQLite con
// `example-mini` (su web con un «componente» que cambia con la query, su Chrome de captura y su sheets.json), con el
// simulador de Figma como pestaña: reconoce el código fijo del paso y contesta desde el plan que recibe como asset. Sin Figma,
// sin el proyecto consumidor y sin el 9222.
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

const SHEET_STEP = { use: "kit/build-component@1", sheet: "marca" };
const EXPRESSION = /kit\.steps\.buildComponent\(params, assets, recognize\)/;
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
	const r = await e.claude.callTool(TOOL_NAME.capture, {
		screens: ["cmp-marca"],
	});
	assert.equal(r.isError, false, r.text);
	return r;
}

async function build(e: CaptureEnvironment, args: Record<string, unknown>) {
	const started = await e.claude.callTool(TOOL_NAME.build, args);
	if (started.isError || started.out["jobId"] === undefined) return { started };
	const end = await e.claude.waitJob(String(started.out["jobId"]));
	return { started, end };
}

const textsOf = (nodes: Json[]): string[] =>
	nodes.flatMap((n) =>
		n["t"] === "text" ? [String(n["txt"])] : textsOf(n["kids"] ?? []),
	);

describe("E75 · capturar un componente", () => {
	it("navega una vez por variante con su query y con el viewport de la pantalla; la captura cumple capture@1", async () => {
		const e = await start();
		await capture(e);
		const days = await readdir(join(e.outputDir, "web-captures"));
		const day = days.find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ?? "";
		const files = await readdir(join(e.outputDir, "web-captures", day));
		const file = files.find((f) => f.startsWith("cmp-marca_")) ?? "";
		const stored = await readJson(join(e.outputDir, "web-captures", day, file));
		assert.equal(stored["contract"], "capture@1");
		assert.equal(stored["variants"].length, 2);
		assert.deepEqual(
			stored["variants"].map((v: Json) => v["props"]),
			[{ tamano: "sm" }, { tamano: "lg" }],
		);
		// la query llegó a la web (el ancho y la etiqueta cambian) y la pestaña medía 300, no los 800 de project@1
		const widths = stored["variants"].map((v: Json) => v["nodes"][0]["w"]);
		assert.deepEqual(widths, [60, 120]);
		assert.deepEqual(
			stored["variants"].map((v: Json) => textsOf(v["nodes"])),
			[["Marca 300"], ["Marca grande 300"]],
		);
		assert.equal(stored["source"]["viewport"].w, 800);
	});
});

describe("E76 · build-component en un manifiesto", () => {
	it("corre con el plan y las imágenes como assets, deja el plan en sheet-plans/ y su etiqueta sale en el progreso, el histórico y los intentos", async () => {
		const e = await start();
		await capture(e);
		const { started, end } = await build(e, { steps: [SHEET_STEP] });
		assert.equal(started.isError, false, started.text);
		assert.equal(
			(started.out["steps"] as { file: string }[])[0]?.file,
			"kit/build-component@1 · marca",
		);
		assert.equal(end?.out["status"], "done", end?.text ?? "");

		const [expression] = sentExpressions(e);
		const recognize = await readFile(
			join(projectOf(e), "recognize.js"),
			"utf8",
		);
		assert.ok(
			expression?.includes(kitStepCode("kit/build-component@1", { recognize })),
		);
		const plan = planOf(expression ?? "");
		assert.equal(plan["contract"], "component@1");
		assert.equal(plan["sheet"].key, "marca");
		assert.deepEqual(plan["target"].page, {
			name: "   Marca",
			key: "fcc:sheet-page:marca",
			after: "Panel",
		});
		assert.deepEqual(plan["target"].set, {
			name: "Marca",
			key: "fcc:sheet:marca",
		});
		assert.equal(plan["variants"].length, 2);
		assert.deepEqual(plan["matrix"].rows, ["tamano=sm", "tamano=lg"]);
		assert.deepEqual(plan["rules"], ["Boton"]);
		// la huella del propio set va en el plan: compite y, si gana, el kit no instancia; quitarla haría ganar a la
		// siguiente mejor
		assert.equal(plan["fingerprints"]?.["atomos.marca"].title, "Marca");
		assert.deepEqual(
			plan["warnings"].filter((w: Json) => w["code"] === "RULE_UNNAMED"),
			[],
		);

		const days = await readdir(join(e.outputDir, "sheet-plans"));
		assert.equal(days.length, 1);
		const files = await readdir(
			join(e.outputDir, "sheet-plans", days[0] ?? ""),
		);
		assert.equal(files.length, 1);
		assert.match(files[0] ?? "", /^marca_\d{6}\.json$/);
		const stored = await readJson(
			join(e.outputDir, "sheet-plans", days[0] ?? "", files[0] ?? ""),
		);
		assert.equal(
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
			"kit/build-component@1 · marca",
		);
		const attempts = await e.claude.callTool(TOOL_NAME.historyAttempts, {
			target: "kit/build-component@1 · marca",
		});
		assert.equal(attempts.isError, false, attempts.text);
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
			"sheets",
			"step",
		]);
	});

	it("cambiar sheets.json da «cambiaron sheets y plan» (CA-7)", async () => {
		const e = await start();
		await capture(e);
		await build(e, { steps: [SHEET_STEP] });
		const file = join(projectOf(e), "sheets.json");
		const sheets = await readJson(file);
		sheets["sheets"][0].description = "Otra descripción";
		await writeFile(file, JSON.stringify(sheets));
		await build(e, { steps: [SHEET_STEP] });
		const list = await e.claude.callTool(TOOL_NAME.historyAttempts, {
			target: "kit/build-component@1 · marca",
		});
		assert.equal(list.isError, false, list.text);
		const items = list.out["items"] as {
			n: number;
			changed: string[] | null;
			change: string;
		}[];
		assert.deepEqual(
			items.map((i) => i.n),
			[1, 2],
		);
		assert.deepEqual(items[1]?.changed, ["sheets", "plan"]);
		assert.match(items[1]?.change ?? "", /cambiaron sheets y plan/);
	});
});

describe("E77 · validación previa de build-component", () => {
	// La captura previa también es un job: se comparan los jobs de antes y de después del lote rechazado
	const jobsOf = (e: CaptureEnvironment) =>
		e.env.rows("SELECT 1 FROM jobs").length;
	const nothingSent = (e: CaptureEnvironment, jobsBefore: number) => {
		assert.equal(sentExpressions(e).length, 0, "no se envió nada a la pestaña");
		assert.equal(jobsOf(e), jobsBefore, "no hay job nuevo");
	};

	it("sin `sheets` en project@1: ProjectConfigError con el campo `sheets`, sin job ni envío", async () => {
		const e = await start();
		await capture(e);
		const file = join(projectOf(e), "figma-control-center.json");
		const config = await readJson(file);
		delete config["sheets"];
		await writeFile(file, JSON.stringify(config));
		const before = jobsOf(e);
		const { started } = await build(e, { steps: [SHEET_STEP] });
		assert.equal(started.isError, true);
		assert.match(started.text, /sheets/);
		assert.equal(started.out["jobId"] ?? null, null);
		nothingSent(e, before);
	});

	it("un sheets.json roto o con una pantalla que no existe: ContractError con el puntero JSON, sin job ni envío", async () => {
		const e = await start();
		await capture(e);
		const file = join(projectOf(e), "sheets.json");
		const sheets = await readJson(file);
		sheets["sheets"][0].matrix = { align: "bottom" };
		await writeFile(file, JSON.stringify(sheets));
		const before = jobsOf(e);
		const broken = await build(e, { steps: [SHEET_STEP] });
		assert.equal(broken.started.isError, true);
		assert.match(broken.started.text, /\/sheets\/0\/matrix\/align/);
		nothingSent(e, before);

		sheets["sheets"][0].matrix = {};
		sheets["sheets"][0].screen = "fantasma";
		await writeFile(file, JSON.stringify(sheets));
		const crossed = await build(e, { steps: [SHEET_STEP] });
		assert.equal(crossed.started.isError, true);
		assert.match(crossed.started.text, /\/sheets\/0\/screen/);
		nothingSent(e, before);
	});

	it("una hoja desconocida o sin captura: error de uso que dice qué hacer, sin job ni envío", async () => {
		const e = await start();
		const noCapture = await build(e, { steps: [SHEET_STEP] });
		assert.equal(noCapture.started.isError, true);
		assert.match(noCapture.started.text, /figma_capture/);
		await capture(e);
		const before = jobsOf(e);
		const unknown = await build(e, {
			steps: [{ use: "kit/build-component@1", sheet: "fantasma" }],
		});
		assert.equal(unknown.started.isError, true);
		assert.match(unknown.started.text, /marca/);
		nothingSent(e, before);
		// nada se quedó reservado: un lote correcto sale
		const ok = await build(e, { steps: [SHEET_STEP] });
		assert.equal(ok.end?.out["status"], "done", ok.end?.text ?? "");
	});

	it("assets sobre el tope: el error con el tope, sin job ni envío", async () => {
		const e = await start({ FCC_MAX_ASSET_BYTES: "200" });
		await capture(e);
		const before = jobsOf(e);
		const { started } = await build(e, { steps: [SHEET_STEP] });
		assert.equal(started.isError, true);
		assert.match(started.text, /tope|200/);
		nothingSent(e, before);
	});
});
