import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { CdpClient } from "#adapters/cdp/cdp-client.ts";
import { CdpFigmaGateway } from "#adapters/cdp/cdp-figma-gateway.ts";
import { CdpFigmaReader } from "#adapters/cdp/cdp-figma-reader.ts";
import { KIT_PROBE_EXPRESSION } from "#adapters/cdp/figma-kit.ts";
import { FIGMA_KIT_SHA_GLOBAL } from "#adapters/cdp/protocol.ts";
import { startFakeCdp } from "#adapters/cdp/testing/fake-cdp-server.ts";
import { SCRIPT_FORMAT } from "#application/ports/figma-gateway.ts";
import { EXPORT_FORMAT, STYLE_KIND } from "#domain/catalog.ts";
import {
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
} from "#domain/figma-error.ts";
import { pngDimensions } from "../contracts/figma-values.ts";
import {
	LINE_MARKER,
	SCENARIOS,
	SCRIPTS_DIR,
} from "../fixtures/scenarios/scenarios.ts";
import { DEFAULT_WORLD } from "../fixtures/scenarios/world.ts";
import { type FigmaSimulator, startFigmaSimulator } from "./figma-simulator.ts";
import { until } from "./wait.ts";

const FILE_URL = "https://www.figma.com/design/SIMULADO/Archivo";

const open: FigmaSimulator[] = [];
afterEach(async () => {
	// close() falla si el doble emitió algo que el contrato no permite
	for (const sim of open.splice(0)) await sim.close();
});

const setup = async (
	options: Parameters<typeof startFigmaSimulator>[0] = {},
	client: { callTimeoutMs?: number; readyTimeoutMs?: number } = {},
) => {
	const sim = await startFigmaSimulator({
		tabUrl: `${FILE_URL}?node-id=1`,
		...options,
	});
	open.push(sim);
	const cdp = new CdpClient({
		host: "127.0.0.1",
		port: sim.port,
		fileUrl: FILE_URL,
		callTimeoutMs: client.callTimeoutMs ?? 2000,
		readyTimeoutMs: client.readyTimeoutMs ?? 300,
		readyPollIntervalMs: 20,
	});
	return {
		sim,
		gateway: new CdpFigmaGateway(cdp),
		reader: new CdpFigmaReader(cdp),
		cdp,
	};
};

const scenarioScript = (file: string) =>
	readFileSync(join(SCRIPTS_DIR, file), "utf8");
// Línea (desde 1) del archivo donde está el marcador: el valor que DEBE informar el adaptador
const markerLine = (file: string, marker: string) =>
	scenarioScript(file)
		.split("\n")
		.findIndex((l) => l.includes(marker)) + 1;

describe("simulador de Figma: el kit de Figma", () => {
	const kitCalls = (sim: FigmaSimulator) => ({
		probes: sim.expressions.filter((e) => e === KIT_PROBE_EXPRESSION).length,
		installs: sim.expressions.filter((e) => e.includes(FIGMA_KIT_SHA_GLOBAL))
			.length,
	});
	const writeCreated = () => ({
		code: scenarioScript(SCENARIOS.writeCreated.script),
		format: SCRIPT_FORMAT.body,
	});

	it("contesta a la pregunta por el kit y a su instalación: se instala una vez", async () => {
		const { sim, gateway, cdp } = await setup();
		const first = await gateway.run(writeCreated(), { installKit: true });
		const second = await gateway.run(writeCreated(), { installKit: true });
		cdp.close();
		assert.ok(first.ok && second.ok);
		assert.deepEqual(kitCalls(sim), { probes: 3, installs: 1 });
	});

	it("una recarga simulada de la pestaña borra el kit: la siguiente llamada lo instala otra vez", async () => {
		const { sim, gateway, cdp } = await setup();
		await gateway.run(writeCreated(), { installKit: true });
		sim.reloadTab();
		const again = await gateway.run(writeCreated(), { installKit: true });
		cdp.close();
		assert.ok(again.ok);
		assert.equal(kitCalls(sim).installs, 2);
	});

	it("los scripts internos no preguntan ni instalan", async () => {
		const { sim, gateway, cdp } = await setup();
		await gateway.metadata(null, 0);
		await gateway.screenshot("10:1", 1);
		await gateway.run(writeCreated());
		cdp.close();
		assert.deepEqual(kitCalls(sim), { probes: 0, installs: 0 });
	});
});

describe("simulador de Figma", () => {
	it("figma_status: el archivo y la página del mundo simulado", async () => {
		const { gateway, cdp } = await setup();
		const status = await gateway.status();
		cdp.close();
		assert.equal(status.figmaReady, true);
		assert.equal(status.fileName, DEFAULT_WORLD.file);
		assert.equal(status.pageName, DEFAULT_WORLD.page);
	});

	it("metadatos: el árbol hasta la profundidad pedida", async () => {
		const { gateway, cdp } = await setup();
		const shallow = await gateway.metadata(null, 0);
		const deep = await gateway.metadata("10:1", 1);
		cdp.close();
		assert.ok(shallow.ok && deep.ok);
		assert.deepEqual(shallow.value, {
			id: "0:1",
			name: "Inicio",
			type: "PAGE",
		});
		assert.deepEqual(
			deep.value.children?.map((c) => c.id),
			["10:2"],
		);
	});

	it("captura: un PNG con el tamaño del nodo por la escala", async () => {
		const { gateway, cdp } = await setup();
		const shot = await gateway.screenshot("10:1", 2);
		cdp.close();
		assert.ok(shot.ok);
		assert.deepEqual(pngDimensions(Buffer.from(shot.value.png)), {
			width: 240,
			height: 160,
		});
	});

	it("un nodo que no existe es NodeNotFound", async () => {
		const { gateway, cdp } = await setup();
		const shot = await gateway.screenshot("99:99", 1);
		cdp.close();
		assert.ok(!shot.ok);
		assert.equal(shot.error.type, FIGMA_ERROR_TYPE.nodeNotFound);
	});

	it("escritura: devuelve el valor del escenario", async () => {
		const { gateway, cdp } = await setup();
		const run = await gateway.run({
			code: scenarioScript(SCENARIOS.writeCreated.script),
			format: SCRIPT_FORMAT.body,
		});
		cdp.close();
		assert.ok(run.ok);
		assert.deepEqual(run.value, {
			createdNodeIds: ["10:1", "10:2"],
			mutatedNodeIds: ["10:3"],
		});
	});

	it("error de sintaxis: la línea del script, retryable", async () => {
		const { gateway, cdp } = await setup();
		const run = await gateway.run({
			code: scenarioScript(SCENARIOS.errorSyntax.script),
			format: SCRIPT_FORMAT.function,
		});
		cdp.close();
		assert.ok(!run.ok);
		assert.equal(run.error.type, FIGMA_ERROR_TYPE.scriptError);
		assert.equal(
			run.error.line,
			markerLine(SCENARIOS.errorSyntax.script, LINE_MARKER.syntax),
		);
		assert.equal(run.error.retryable, false);
	});

	it("error de ejecución: la línea del script, no reintentable", async () => {
		const { gateway, cdp } = await setup();
		const run = await gateway.run({
			code: scenarioScript(SCENARIOS.errorRuntime.script),
			format: SCRIPT_FORMAT.body,
		});
		cdp.close();
		assert.ok(!run.ok);
		assert.ok(run.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.equal(
			run.error.line,
			markerLine(SCENARIOS.errorRuntime.script, LINE_MARKER.throws),
		);
		assert.equal(run.error.retryable, false);
	});

	it("error dentro del API de Figma: la línea apunta al script, no al bundle de Figma", async () => {
		const { gateway, cdp } = await setup();
		const run = await gateway.run({
			code: scenarioScript(SCENARIOS.errorFigmaInternal.script),
			format: SCRIPT_FORMAT.body,
		});
		cdp.close();
		assert.ok(!run.ok);
		assert.ok(run.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.equal(
			run.error.line,
			markerLine(SCENARIOS.errorFigmaInternal.script, LINE_MARKER.throws),
		);
		assert.notEqual(run.error.line, 2, "2 es la línea del bundle de Figma");
	});

	it("un script que no responde agota el plazo (Timeout)", async () => {
		const { gateway, cdp } = await setup({}, { callTimeoutMs: 150 });
		const run = await gateway.run({
			code: scenarioScript(SCENARIOS.errorTimeout.script),
			format: SCRIPT_FORMAT.body,
		});
		cdp.close();
		assert.ok(!run.ok);
		assert.equal(run.error.type, FIGMA_ERROR_TYPE.timeout);
	});

	it("un script con puerta no responde hasta que se libera", async () => {
		const { gateway, sim, cdp } = await setup();
		const gate = SCENARIOS.longRunning.reply.gate;
		let done = false;
		const pending = gateway
			.run({
				code: scenarioScript(SCENARIOS.longRunning.script),
				format: SCRIPT_FORMAT.body,
			})
			.then((r) => {
				done = true;
				return r;
			});
		await until("el script llega a la puerta", () => sim.waiting(gate) === 1);
		assert.equal(done, false);
		sim.release(gate);
		const run = await pending;
		cdp.close();
		assert.ok(run.ok);
	});

	it("sin pestaña del archivo: FigmaTabNotFound", async () => {
		const { gateway, cdp } = await setup({
			tabUrl: "https://www.figma.com/design/OTRO/Otro",
		});
		const status = await gateway.status();
		cdp.close();
		assert.equal(status.error?.type, FIGMA_ERROR_TYPE.figmaTabNotFound);
	});

	it("con el editor sin cargar: FigmaNotReady", async () => {
		const { gateway, cdp } = await setup({ ready: false });
		const run = await gateway.run({
			code: "return 1;",
			format: SCRIPT_FORMAT.body,
		});
		cdp.close();
		assert.ok(!run.ok);
		assert.equal(run.error.type, FIGMA_ERROR_TYPE.figmaNotReady);
	});

	it("figma_status sin permiso de edición: FigmaNotReady por solo lectura", async () => {
		const { gateway, cdp } = await setup({
			ready: false,
			notReadyBecause: "viewOnly",
		});
		const status = await gateway.status();
		cdp.close();
		assert.ok(status.error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(status.error.reason, FIGMA_NOT_READY_REASON.viewOnly);
	});

	it("un script sin escenario falla alto y claro en vez de inventar una respuesta", async () => {
		const { gateway, cdp } = await setup();
		const run = await gateway.run({
			code: "return 1;",
			format: SCRIPT_FORMAT.body,
		});
		cdp.close();
		assert.ok(!run.ok);
		assert.match(run.error.message, /no reconoce este script/);
	});
});

describe("simulador de Figma: lecturas del catálogo (M3)", () => {
	it("variables: las colecciones del mundo con modos y alias; `collection` filtra", async () => {
		const { reader, cdp } = await setup();
		const all = await reader.variables({ collection: null, nodeId: null });
		const one = await reader.variables({
			collection: "Primitives",
			nodeId: null,
		});
		cdp.close();
		assert.ok(all.ok && one.ok);
		assert.deepEqual(
			all.value.collections.map((c) => c.name),
			DEFAULT_WORLD.catalog.variables.collections.map((c) => c.name),
		);
		assert.deepEqual(
			one.value.collections.map((c) => c.name),
			["Primitives"],
		);
	});

	it("variables de un nodo: solo las ligadas en su subárbol, con los enlaces; un nodo que no existe es NodeNotFound", async () => {
		const { reader, cdp } = await setup();
		const bound = await reader.variables({ collection: null, nodeId: "10:1" });
		const missing = await reader.variables({
			collection: null,
			nodeId: "99:9",
		});
		cdp.close();
		assert.ok(bound.ok);
		assert.deepEqual(
			bound.value.bindings,
			DEFAULT_WORLD.catalog.bindings.get("10:1"),
		);
		const ids = new Set(bound.value.bindings?.map((b) => b.variableId));
		for (const c of bound.value.collections) {
			for (const v of c.variables) assert.ok(ids.has(v.id), v.id);
		}
		assert.ok(
			!missing.ok && missing.error.type === FIGMA_ERROR_TYPE.nodeNotFound,
		);
	});

	it("estilos y componentes del mundo, con sus filtros; una página que no existe es ScriptError con su nombre", async () => {
		const { reader, cdp } = await setup();
		const text = await reader.styles(STYLE_KIND.text);
		const sets = await reader.components({ page: null, query: "botón" });
		const missing = await reader.components({ page: "Nada", query: null });
		cdp.close();
		assert.ok(text.ok && sets.ok);
		assert.deepEqual(
			text.value.map((s) => s.kind),
			["text"],
		);
		assert.deepEqual(
			sets.value.map((c) => c.name),
			["Botón"],
		);
		assert.ok(
			!missing.ok && missing.error.type === FIGMA_ERROR_TYPE.scriptError,
		);
		assert.match(missing.error.message, /Nada/);
	});

	it("instancias: los frames de las páginas pedidas; `frame` deja uno", async () => {
		const { reader, cdp } = await setup();
		const all = await reader.instances({ pages: ["Inicio"], frame: null });
		const one = await reader.instances({ pages: ["Inicio"], frame: "Tarjeta" });
		cdp.close();
		assert.ok(all.ok && one.ok);
		assert.deepEqual(all.value, DEFAULT_WORLD.catalog.frames);
		assert.deepEqual(
			one.value.map((f) => f.frameName),
			["Tarjeta"],
		);
	});

	it("exportación: bytes con la firma del formato y el tamaño del nodo por la escala en PNG", async () => {
		const { reader, cdp } = await setup();
		const png = await reader.export({
			nodeIds: ["10:1", "10:3"],
			format: EXPORT_FORMAT.png,
			scale: 2,
		});
		const svg = await reader.export({
			nodeIds: ["10:1"],
			format: EXPORT_FORMAT.svg,
			scale: 1,
		});
		const missing = await reader.export({
			nodeIds: ["99:9"],
			format: EXPORT_FORMAT.pdf,
			scale: 1,
		});
		cdp.close();
		assert.ok(png.ok && svg.ok);
		assert.deepEqual(
			png.value.map((n) => [n.nodeId, n.width, n.height]),
			[
				["10:1", 240, 160],
				["10:3", 128, 64],
			],
		);
		assert.match(Buffer.from(svg.value[0]?.bytes ?? []).toString(), /^<svg/);
		assert.ok(
			!missing.ok && missing.error.type === FIGMA_ERROR_TYPE.nodeNotFound,
		);
	});
});

describe("el doble valida contra el contrato (CA-3)", () => {
	it("una respuesta que el contrato no permite queda como violación y close() falla", async () => {
		const fake = await startFakeCdp({
			respond: () => ({
				kind: "protocolError",
				code: 1.5,
				message: "código no entero",
			}),
		});
		const cdp = new CdpClient({
			host: "127.0.0.1",
			port: fake.port,
			fileUrl: "https://www.figma.com/design/KEY/Nombre",
			callTimeoutMs: 300,
			readyTimeoutMs: 100,
			readyPollIntervalMs: 20,
		});
		await cdp.evaluate("1", { waitReady: false });
		cdp.close();
		assert.equal(fake.violations.length, 1);
		await assert.rejects(fake.close(), /contrato no permite/);
	});
});
