// E78 a E80 de las hojas de componentes, segunda mitad: `figma_build { sheets }` arma un paso
// por hoja en el orden del fichero y dice qué hojas no entran; y `example-mini` recorre captura → build-component → build-screen
// sin ningún dato de una web real; y E80, el informe de desfase (`SHEET_DRIFT`) que llega a reads/ sin parar el lote. Servidor MCP real + SQLite con `example-mini`, con el simulador de Figma como pestaña. Sin Figma,
// sin el proyecto consumidor y sin el 9222.
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
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

const SHEET_EXPRESSION =
	/kit\.steps\.buildComponent\(params, assets, recognize\)/;
const SCREEN_EXPRESSION =
	/kit\.steps\.buildScreen\(params, assets, recognize\)/;
const sent = (e: CaptureEnvironment, expression: RegExp) =>
	(e.env.simulator?.expressions ?? []).filter((x) => expression.test(x));

const planOf = (expression: string): Json => {
	const b64 = /"plan":figma\.base64Decode\("([^"]*)"\)/.exec(expression)?.[1];
	assert.ok(b64, "el asset `plan` no está en el código enviado");
	return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Json;
};

async function start() {
	c = await startCaptureEnvironment({ projectIsScriptsRoot: true });
	return c;
}

async function capture(e: CaptureEnvironment, screens: string[]) {
	const r = await e.claude.callTool(TOOL_NAME.capture, { screens });
	assert.equal(r.isError, false, r.text);
}

async function build(e: CaptureEnvironment, args: Record<string, unknown>) {
	const started = await e.claude.callTool(TOOL_NAME.build, args);
	if (started.isError || started.out["jobId"] === undefined) return { started };
	const end = await e.claude.waitJob(String(started.out["jobId"]));
	return { started, end };
}

// Una hoja más sobre la misma pantalla `cmp-marca` (un segundo componente con otra página) delante de la de siempre: el orden
// del fichero no es el de la lista; y una tercera sobre una pantalla que nunca se captura
async function addSheets(e: CaptureEnvironment) {
	const dir = projectOf(e);
	const sheets = await readJson(join(dir, "sheets.json"));
	const brand = sheets["sheets"][0];
	sheets["sheets"] = [
		{
			...brand,
			key: "marca2",
			title: "Marca 2",
			page: { name: "   Marca 2" },
			rules: [],
		},
		brand,
		{
			...brand,
			key: "sin-captura",
			screen: "cmp-sin-captura",
			title: "Sin captura",
			page: { name: "   Sin captura" },
			rules: [],
		},
	];
	await writeFile(join(dir, "sheets.json"), JSON.stringify(sheets));
	const screens = await readJson(join(dir, "screens.json"));
	const origin = screens["screens"].find((s: Json) => s["key"] === "cmp-marca");
	screens["screens"].push({
		...origin,
		key: "cmp-sin-captura",
		title: "Sin captura",
	});
	await writeFile(join(dir, "screens.json"), JSON.stringify(screens));
}

describe("E78 · figma_build { sheets }", () => {
	it("un paso por hoja en el orden del fichero (no el de la lista) y el mismo plan que el manifiesto escrito a mano", async () => {
		const e = await start();
		await addSheets(e);
		await capture(e, ["cmp-marca"]);
		const { started, end } = await build(e, { sheets: ["marca", "marca2"] });
		assert.equal(started.isError, false, started.text);
		assert.deepEqual(
			(started.out["steps"] as { file: string }[]).map((s) => s.file),
			["kit/build-component@1 · marca2", "kit/build-component@1 · marca"],
		);
		assert.equal(started.out["skippedSheets"], undefined);
		assert.equal(end?.out["status"], "done", end?.text ?? "");
		const viaSheets = sent(e, SHEET_EXPRESSION).map(planOf);
		assert.deepEqual(
			viaSheets.map((p) => p["sheet"].key),
			["marca2", "marca"],
		);

		// el mismo lote escrito a mano en un manifiesto
		await writeFile(
			join(projectOf(e), "lote-hojas.json"),
			JSON.stringify({
				name: "hojas",
				steps: [
					{ use: "kit/build-component@1", sheet: "marca2" },
					{ use: "kit/build-component@1", sheet: "marca" },
				],
			}),
		);
		const manual = await build(e, {
			manifest: join(projectOf(e), "lote-hojas.json"),
		});
		assert.equal(manual.end?.out["status"], "done", manual.end?.text ?? "");
		const viaManifest = sent(e, SHEET_EXPRESSION).slice(2).map(planOf);
		assert.deepEqual(viaManifest, viaSheets);
	});

	it("una hoja sin captura válida no tiene paso y la respuesta lo dice con NO_SOURCE; el resto del lote corre", async () => {
		const e = await start();
		await addSheets(e);
		await capture(e, ["cmp-marca"]);
		const { started, end } = await build(e, {
			sheets: ["sin-captura", "marca"],
		});
		assert.equal(started.isError, false, started.text);
		assert.deepEqual(
			(started.out["steps"] as { file: string }[]).map((s) => s.file),
			["kit/build-component@1 · marca"],
		);
		const skipped = started.out["skippedSheets"] as {
			sheet: string;
			code: string;
			message: string;
		}[];
		assert.equal(skipped.length, 1);
		assert.equal(skipped[0]?.sheet, "sin-captura");
		assert.equal(skipped[0]?.code, "NO_SOURCE");
		assert.match(skipped[0]?.message ?? "", /cmp-sin-captura.*figma_capture/);
		assert.equal(end?.out["status"], "done", end?.text ?? "");
		assert.equal(sent(e, SHEET_EXPRESSION).length, 1);
	});

	it("sin ninguna captura, una hoja desconocida o un proyecto sin `sheets` son un error sin job ni envío", async () => {
		const e = await start();
		const jobs = () => e.env.rows("SELECT 1 FROM jobs").length;
		const before = jobs();
		const none = await build(e, { sheets: ["marca"] });
		assert.equal(none.started.isError, true);
		assert.match(none.started.text, /NO_SOURCE/);
		await capture(e, ["cmp-marca"]);
		const jobsBefore = jobs();
		const unknown = await build(e, { sheets: ["fantasma"] });
		assert.equal(unknown.started.isError, true);
		assert.match(unknown.started.text, /fantasma.*marca/);
		const file = join(projectOf(e), "figma-control-center.json");
		const config = await readJson(file);
		delete config["sheets"];
		await writeFile(file, JSON.stringify(config));
		const missing = await build(e, { sheets: ["marca"] });
		assert.equal(missing.started.isError, true);
		assert.match(missing.started.text, /sheets/);
		assert.equal(sent(e, SHEET_EXPRESSION).length, 0, "no se envió nada");
		assert.equal(jobs(), jobsBefore, "ninguno de los rechazos abrió un job");
		assert.ok(jobsBefore >= before);
	});
});

describe("E80 · Figma va por delante de la web", () => {
	it("el paso que informa de un desfase no escribe, su informe entero queda en reads/ con la ruta en el aviso, y el lote sigue con la hoja siguiente", async () => {
		const e = await start();
		await addSheets(e);
		const file = join(projectOf(e), "sheets.json");
		const sheets = await readJson(file);
		sheets["sheets"][0].description =
			"DESFASE: Figma tiene una prop que la web no";
		await writeFile(file, JSON.stringify(sheets));
		await capture(e, ["cmp-marca"]);
		const { end } = await build(e, {
			sheets: ["marca2", "marca"],
			stopOnError: true,
		});
		assert.equal(end?.out["status"], "done", end?.text ?? "");
		const steps = end?.out["steps"] as {
			file: string;
			status: string;
			warning: string | null;
		}[];
		assert.deepEqual(
			steps.map((s) => s.status),
			["done", "done"],
		);
		assert.match(
			steps[0]?.warning ?? "",
			/^SHEET_DRIFT: .*detalle del desfase: .*reads\/desfase_marca2_/,
		);
		assert.equal(steps[1]?.warning, null);
		assert.equal(
			sent(e, SHEET_EXPRESSION).length,
			2,
			"la hoja siguiente se envió",
		);

		const reads = (await readdir(join(e.outputDir, "reads"))).filter((f) =>
			f.startsWith("desfase_marca2_"),
		);
		assert.equal(reads.length, 1);
		const drift = await readJson(join(e.outputDir, "reads", reads[0] ?? ""));
		assert.equal(drift["sheet"], "marca2");
		assert.deepEqual(drift["figmaOnlyProps"], { card: ["no", "title"] });

		// el dato queda también en el histórico del paso, que es lo que leerá la página «Desfases»
		const calls = e.env.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const call = await e.claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[0]?.call_id,
			step: 0,
		});
		assert.match(JSON.stringify(call.out), /"drift"/);
	});
});

describe("E79 · genérico", () => {
	it("example-mini recorre captura → build-component → build-screen (la pantalla lleva la huella del set recién hecho) sin ningún dato de una web real", async () => {
		const e = await start();
		await capture(e, ["cmp-marca", "inicio"]);
		const sheet = await build(e, { sheets: ["marca"] });
		assert.equal(sheet.end?.out["status"], "done", sheet.end?.text ?? "");
		const screen = await build(e, { areas: ["Panel"] });
		assert.equal(screen.end?.out["status"], "done", screen.end?.text ?? "");

		const [sheetPlan] = sent(e, SHEET_EXPRESSION).map(planOf);
		const [screenPlan] = sent(e, SCREEN_EXPRESSION).map(planOf);
		// la huella que usa la pantalla es la del set que acaba de pintar la hoja: el mismo título
		const title = sheetPlan?.["sheet"].title;
		assert.equal(title, "Marca");
		assert.deepEqual(
			Object.values(screenPlan?.["fingerprints"] as Record<string, Json>).map(
				(f) => f["title"],
			),
			[title],
		);
		const calls = e.env.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const last = await e.claude.callTool(TOOL_NAME.historyCall, {
			callId: calls.at(-1)?.call_id,
			step: 0,
		});
		assert.match(JSON.stringify(last.out), /"set":"Marca"/);

		// todo lo que se envió son datos del proyecto de ejemplo
		const all = (e.env.simulator?.expressions ?? []).join("\n");
		assert.ok(
			!/djDebug|x-data|x-cloak|csrfmiddlewaretoken/.test(all),
			"el código enviado nombra algo de una web real",
		);
	});
});
