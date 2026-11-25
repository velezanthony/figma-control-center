import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
	figmaNotReady,
	scriptError,
} from "#domain/figma-error.ts";
import { JOB_STATUS, toJobId } from "#domain/job.ts";
import { err, ok } from "#domain/result.ts";
import { NO_IDS_WARNING } from "#domain/run-outcome.ts";
import { createJobRegistry } from "./job-registry.ts";
import { SCRIPT_FORMAT } from "./ports/figma-gateway.ts";
import { makeAttemptRecorder } from "./record-attempt.ts";
import { makeRunScript } from "./run-script.ts";
import { fakeStepIssues } from "./testing/fake-step-check.ts";
import { InMemoryAttemptLog } from "./testing/in-memory-attempt-log.ts";
import {
	deferred,
	InMemoryFigmaGateway,
} from "./testing/in-memory-figma-gateway.ts";
import {
	InMemoryAssetRepository,
	InMemoryResultStore,
	InMemoryScriptRepository,
} from "./testing/in-memory-ports.ts";

function setup(
	overrides: {
		softDeadlineMs?: number;
		maxInlineResultBytes?: number;
		maxParamsBytes?: number;
	} = {},
) {
	const finishedJobs: { jobId: string; ok: boolean; ms: number }[] = [];
	let clock = 0;
	const gateway = new InMemoryFigmaGateway();
	const scripts = new InMemoryScriptRepository();
	const assets = new InMemoryAssetRepository();
	const store = new InMemoryResultStore();
	let n = 0;
	const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
	const attemptLog = new InMemoryAttemptLog();
	const run = makeRunScript({
		attempts: makeAttemptRecorder({
			log: attemptLog,
			scripts,
			assets,
			clock: () => new Date(0),
			kits: {
				figma: () => ({ version: "figma-kit@1", content: "KIT" }),
				capture: () => ({ version: "capture-kit@1", content: "KIT" }),
			},
			warn: (m) => assert.fail(m),
		}),
		checkStep: fakeStepIssues,
		gateway,
		scripts,
		assets,
		store,
		jobs,
		softDeadlineMs: overrides.softDeadlineMs ?? 1000,
		maxInlineResultBytes: overrides.maxInlineResultBytes ?? 100,
		maxParamsBytes: overrides.maxParamsBytes ?? 20_000,
		now: () => (clock += 50),
		onJobFinished: ({ jobId, outcome, ms }) =>
			finishedJobs.push({ jobId, ok: outcome.ok, ms }),
	});
	return {
		gateway,
		scripts,
		assets,
		store,
		jobs,
		run,
		finishedJobs,
		attemptLog,
	};
}

const code = (source: string) => ({ kind: "code", code: source }) as const;

describe("makeRunScript: la pestaña se espera antes de la carrera contra el plazo blando", () => {
	it("con la pestaña cargando tras el plazo blando responde FigmaNotReady loading, no un job (CA-7)", async () => {
		const { gateway, jobs, run } = setup({ softDeadlineMs: 20 });
		gateway.readyReply = async () => {
			await new Promise((r) => setTimeout(r, 80));
			return err(figmaNotReady(80, FIGMA_NOT_READY_REASON.loading));
		};
		const r = await run({ source: code("1"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error?.type, FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(gateway.runCalls.length, 0, "el script no se envía");
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("sin sesión responde en el acto con su motivo y sin enviar nada (CA-6)", async () => {
		const { gateway, run } = setup();
		gateway.readyReply = async () =>
			err(figmaNotReady(0, FIGMA_NOT_READY_REASON.notLoggedIn));
		const r = await run({ source: code("1"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		const error = r.outcome.error;
		assert.ok(error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(error.reason, FIGMA_NOT_READY_REASON.notLoggedIn);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("lista la pestaña, un script lento sigue siendo un job", async () => {
		const { gateway, run } = setup({ softDeadlineMs: 20 });
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await run({ source: code("1"), format: SCRIPT_FORMAT.body });
		assert.equal(r.kind, "running");
		slow.resolve(ok(null));
	});
});

describe("makeRunScript", () => {
	it("un script de código devuelve el resultado y los ids tocados", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () =>
			ok({ createdNodeIds: ["1:1"], mutatedNodeIds: ["1:2"], total: 2 });
		const r = await run({
			source: code("return 1"),
			format: SCRIPT_FORMAT.body,
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1", "1:2"]);
		assert.deepEqual(gateway.runCalls[0]?.script, {
			code: "return 1",
			format: "body",
		});
	});

	it("ok sin ids declarados lleva el aviso de nodos sin declarar; con ids, no", async () => {
		const { gateway, run } = setup();
		const input = {
			source: { kind: "code", code: "return 1" },
			format: SCRIPT_FORMAT.body,
		} as const;
		gateway.runReply = async () => ok({ movedCount: 3 });
		const sin = await run(input);
		assert.ok(sin.kind === "finished" && sin.outcome.ok);
		assert.equal(sin.outcome.warning, NO_IDS_WARNING);
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const con = await run(input);
		assert.ok(con.kind === "finished" && con.outcome.ok);
		assert.equal(con.outcome.warning, undefined);
	});

	it("un script de lectura que declara listas vacías no lleva el aviso: declaró que no tocó nada", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () =>
			ok({ pages: 3, createdNodeIds: [], mutatedNodeIds: [] });
		const r = await run({
			source: { kind: "code", code: "return 1" },
			format: SCRIPT_FORMAT.body,
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.warning, undefined);
		assert.deepEqual(r.outcome.touchedNodeIds, []);
	});

	it("un script por ruta se lee del repositorio y se envía a Figma", async () => {
		const { gateway, scripts, run } = setup();
		scripts.files.set("/s/a.js", "async () => 1");
		const r = await run({
			source: { kind: "file", path: "/s/a.js" },
			format: SCRIPT_FORMAT.function,
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(gateway.runCalls[0]?.script, {
			code: "async () => 1",
			format: "function",
		});
	});

	it("una ruta ilegible da ScriptReadError sin tocar Figma (CA-6)", async () => {
		const { gateway, run } = setup();
		const r = await run({
			source: { kind: "file", path: "/nada.js" },
			format: SCRIPT_FORMAT.body,
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("un error de Figma es un resultado ok:false con retryable del error (CA-2)", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () =>
			err(scriptError("SyntaxError: x (línea 3)", 3, true));
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, FIGMA_ERROR_TYPE.scriptError);
		assert.equal(r.outcome.retryable, false);
	});

	it("un resultado grande se guarda en disco y la respuesta lleva la ruta", async () => {
		const { gateway, store, run } = setup({ maxInlineResultBytes: 50 });
		const big = { data: "x".repeat(200), createdNodeIds: ["9:9"] };
		gateway.runReply = async () => ok(big);
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.result, {
			path: "/salida/result-1.json",
			bytes: JSON.stringify(big).length,
		});
		assert.deepEqual(r.outcome.touchedNodeIds, ["9:9"]);
		assert.equal(store.json[0], JSON.stringify(big));
	});

	it("un resultado pequeño va inline y no toca el disco", async () => {
		const { gateway, store, run } = setup();
		gateway.runReply = async () => ok({ n: 1 });
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.result, { n: 1 });
		assert.equal(store.json.length, 0);
	});

	it("pasa params y los bytes de los assets al gateway (CA-7)", async () => {
		const { gateway, assets, run } = setup();
		assets.files.set("/a/mapa.png", Uint8Array.from([1, 2, 3]));
		await run({
			source: code("return params"),
			format: SCRIPT_FORMAT.body,
			params: { page: "App" },
			assets: { mapa: "/a/mapa.png" },
		});
		assert.deepEqual(gateway.runCalls[0]?.script, {
			code: "return params",
			format: "body",
			params: { page: "App" },
			assets: { mapa: Uint8Array.from([1, 2, 3]) },
		});
	});

	it("sin params ni assets el script que llega al gateway no los lleva", async () => {
		const { gateway, run } = setup();
		await run({ source: code("return 1"), format: SCRIPT_FORMAT.body });
		assert.deepEqual(gateway.runCalls[0]?.script, {
			code: "return 1",
			format: "body",
		});
	});

	it("un asset fuera de las raíces es ScriptReadError sin tocar Figma (CA-6)", async () => {
		const { gateway, run } = setup();
		const r = await run({
			source: code("x"),
			format: SCRIPT_FORMAT.body,
			assets: { malo: "/fuera.png" },
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("unos params demasiado grandes se rechazan sin tocar Figma (CA-6)", async () => {
		const { gateway, run } = setup({ maxParamsBytes: 10 });
		const r = await run({
			source: code("x"),
			format: SCRIPT_FORMAT.body,
			params: { texto: "demasiado largo para diez bytes" },
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("pasa timeoutMs al gateway", async () => {
		const { gateway, run } = setup();
		await run({
			source: code("x"),
			format: SCRIPT_FORMAT.body,
			timeoutMs: 1234,
		});
		assert.equal(gateway.runCalls[0]?.options?.timeoutMs, 1234);
	});

	it("si supera el plazo blando devuelve jobId y el job termina después (CA-3)", async () => {
		const { gateway, jobs, run } = setup({ softDeadlineMs: 5 });
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "running");
		assert.equal(jobs.get(r.jobId)?.status, JOB_STATUS.running);

		slow.resolve(ok({ createdNodeIds: ["2:2"] }));
		await new Promise((resolve) => setImmediate(resolve));
		const job = jobs.get(r.jobId);
		assert.equal(job?.status, JOB_STATUS.done);
		assert.ok(job && "outcome" in job && job.outcome.ok);
		assert.deepEqual(job.outcome.touchedNodeIds, ["2:2"]);
	});

	it("un script lento que falla deja el job en failed", async () => {
		const { gateway, jobs, run } = setup({ softDeadlineMs: 5 });
		const slow =
			deferred<ReturnType<typeof err<ReturnType<typeof scriptError>>>>();
		gateway.runReply = () => slow.promise;
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "running");
		slow.resolve(err(scriptError("boom", 1, false)));
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(jobs.get(r.jobId)?.status, JOB_STATUS.failed);
	});

	it("una excepción inesperada tras el plazo deja el job en failed", async () => {
		const { gateway, jobs, run } = setup({ softDeadlineMs: 5 });
		const slow = deferred<never>();
		gateway.runReply = () => slow.promise;
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "running");
		slow.resolve(undefined as never);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(jobs.get(r.jobId)?.status, JOB_STATUS.failed);
	});

	it("avisa cuando termina un job, con su duración (CA-3)", async () => {
		const { gateway, run, finishedJobs } = setup({ softDeadlineMs: 5 });
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "running");
		assert.deepEqual(finishedJobs, []);
		slow.resolve(ok(null));
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(finishedJobs, [{ jobId: r.jobId, ok: true, ms: 50 }]);
	});

	it("avisa también cuando el job falla", async () => {
		const { gateway, run, finishedJobs } = setup({ softDeadlineMs: 5 });
		const slow = deferred<never>();
		gateway.runReply = () => slow.promise;
		await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		slow.resolve(undefined as never);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(finishedJobs[0]?.ok, false);
	});

	it("un script que acaba dentro del plazo no genera aviso de job", async () => {
		const { run, finishedJobs } = setup();
		await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.deepEqual(finishedJobs, []);
	});

	it("con un lote en marcha, un figma_run_script se rechaza con error de uso (CA-8)", async () => {
		const { gateway, jobs, run } = setup();
		jobs.startBuild([
			{
				index: 0,
				file: "a.js",
				status: "pending",
				ms: null,
				touchedCount: 0,
				error: null,
				warning: null,
				result: null,
			},
		]);
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "usage");
		assert.match(r.message, /lote en marcha/);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("con un script anterior vencido aún en la pestaña, un figma_run_script se rechaza y dice por qué", async () => {
		const { gateway, jobs, run } = setup();
		const id = jobs.startBuild([]);
		jobs.holdBuildLock(id, new Promise(() => {}));
		jobs.completeBuild(
			id,
			"cancelled",
			{
				ok: true,
				result: null,
				error: null,
				touchedNodeIds: [],
				retryable: false,
			},
			[],
		);
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "usage");
		assert.match(r.message, /script anterior.*sigue/);
		assert.equal(gateway.runCalls.length, 0);
	});
});

describe("makeRunScript: resultFile deja el resultado en results/<nombre>", () => {
	it("el resultado va a results/<nombre> aunque sea pequeño y la respuesta lleva { path, bytes }", async () => {
		const { gateway, store, run } = setup({ maxInlineResultBytes: 10_000 });
		gateway.runReply = async () => ok({ props: [1, 2] });
		const r = await run({
			source: code("return 1"),
			format: SCRIPT_FORMAT.body,
			resultFile: "figma_props.json",
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(store.results, [
			{ fileName: "figma_props.json", json: '{"props":[1,2]}' },
		]);
		assert.deepEqual(r.outcome.result, {
			path: "/salida/results/figma_props.json",
			bytes: 15,
		});
		assert.equal(store.json.length, 0, "no va además a un result-*.json");
	});

	it("los ids que declara el script siguen en la respuesta", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () => ok({ mutatedNodeIds: ["1:2"] });
		const r = await run({
			source: code("return 1"),
			format: SCRIPT_FORMAT.body,
			resultFile: "salida.json",
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:2"]);
	});

	it("un nombre con «/» o «..» es un error de uso sin tocar Figma", async () => {
		for (const bad of ["../fuera.json", "a/b.json", ".."]) {
			const { gateway, store, run } = setup();
			const r = await run({
				source: code("return 1"),
				format: SCRIPT_FORMAT.body,
				resultFile: bad,
			});
			assert.ok(r.kind === "usage", bad);
			assert.match(r.message, /resultFile/);
			assert.equal(gateway.runCalls.length, 0, bad);
			assert.equal(store.results.length, 0, bad);
		}
	});
});

describe("makeRunScript: step@1", () => {
	const HEADER = "// @contract step@1 · prueba\n";
	const input = (body: string) =>
		({
			source: { kind: "code", code: `${HEADER}${body}` },
			format: SCRIPT_FORMAT.body,
		}) as const;

	it("los scripts del proyecto piden al gateway el kit de Figma", async () => {
		const { gateway, run } = setup();
		await run({ source: code("1"), format: SCRIPT_FORMAT.body });
		assert.equal(gateway.runCalls[0]?.options?.installKit, true);
	});

	it("con cabecera y resultado bueno: ok, ids creados y cambiados, sin el aviso de nodos sin declarar", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () =>
			ok({ createdNodeIds: ["1:1"], mutatedNodeIds: ["1:2"] });
		const r = await run(input("return 1"));
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1", "1:2"]);
		assert.equal(r.outcome.warning, undefined);
	});

	it("con cabecera y las dos listas vacías (repetir un paso por clave) no avisa: declarar nada es declarar", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () =>
			ok({ createdNodeIds: [], mutatedNodeIds: [] });
		const r = await run(input("return 1"));
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.touchedNodeIds, []);
		assert.equal(r.outcome.warning, undefined);
	});

	it("los warnings del paso se suman al warning de la respuesta como «código: mensaje» separados por «; »", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () =>
			ok({
				createdNodeIds: ["1:1"],
				mutatedNodeIds: [],
				warnings: [
					{ code: "MULTI_MODE", message: "dos modos" },
					{ code: "VARIANT_APPROX", message: "aproximada", nodeId: "1:1" },
				],
			});
		const r = await run(input("return 1"));
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(
			r.outcome.warning,
			"MULTI_MODE: dos modos; VARIANT_APPROX: aproximada",
		);
	});

	it("removedNodeIds no entra en los ids tocados: esos nodos ya no existen; queda en el resultado", async () => {
		const { gateway, run } = setup({ maxInlineResultBytes: 10_000 });
		gateway.runReply = async () =>
			ok({
				createdNodeIds: ["1:1"],
				mutatedNodeIds: [],
				removedNodeIds: ["1:9"],
			});
		const r = await run(input("return 1"));
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1"]);
		assert.deepEqual(
			(r.outcome.result as { removedNodeIds: string[] }).removedNodeIds,
			["1:9"],
		);
	});

	it("con cabecera y resultado malo: ContractError con el puntero, no reintentable y con los ids que se pueden leer", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () =>
			ok({ createdNodeIds: ["1:1", 7, "1:3"], mutatedNodeIds: ["1:2"] });
		const r = await run(input("return 1"));
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		const error = r.outcome.error;
		assert.ok(error?.type === "ContractError");
		assert.equal(error.path, "/createdNodeIds/1");
		assert.match(error.message, /\/createdNodeIds\/1: no es texto/);
		assert.equal(error.retryable, false);
		assert.equal(r.outcome.retryable, false);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1", "1:3", "1:2"]);
	});

	it("un resultado que ni es un objeto también se juzga (puntero en la raíz)", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () => ok("hecho");
		const r = await run(input("return 'hecho'"));
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.ok(r.outcome.error?.type === "ContractError");
		assert.match(r.outcome.error.message, /no es un objeto/);
	});

	it("sin cabecera nada cambia: el aviso de M2 y ningún juicio, aunque el resultado no tenga la forma", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () => ok({ movedCount: 3, createdNodeIds: [7] });
		const r = await run({
			source: code("return 1"),
			format: SCRIPT_FORMAT.body,
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.warning, NO_IDS_WARNING);
	});

	it("la cabecera solo cuenta en la primera línea: en otra, el script no se juzga", async () => {
		const { gateway, run } = setup();
		gateway.runReply = async () => ok({ movedCount: 3 });
		const r = await run({
			source: code("const a = 1;\n// @contract step@1 · tarde"),
			format: SCRIPT_FORMAT.body,
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.warning, NO_IDS_WARNING);
	});

	it("un script de fichero con cabecera en formato function se juzga igual", async () => {
		const { gateway, scripts, run } = setup();
		scripts.files.set(
			"paso.js",
			`${HEADER}async (params, assets, kit) => ({})`,
		);
		gateway.runReply = async () =>
			ok({ createdNodeIds: "1:1", mutatedNodeIds: [] });
		const r = await run({
			source: { kind: "file", path: "paso.js" },
			format: SCRIPT_FORMAT.function,
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.ok(r.outcome.error?.type === "ContractError");
		assert.equal(r.outcome.error.path, "/createdNodeIds");
	});
});

describe("makeRunScript: historial de intentos", () => {
	it("un script de fichero deja su intento: objetivo, contenido exacto, params, llamada y kit", async () => {
		const { gateway, scripts, attemptLog, run } = setup();
		scripts.files.set("pasos/a.js", "return 42;");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		await run({
			source: { kind: "file", path: "pasos/a.js" },
			format: SCRIPT_FORMAT.body,
			params: { a: 1 },
			callId: "call-7",
		});
		const [saved] = attemptLog.recorded;
		assert.equal(saved?.kind, "run_script");
		assert.equal(saved?.target, "pasos/a.js");
		assert.equal(saved?.callId, "call-7");
		assert.equal(saved?.status, "ok");
		assert.deepEqual(
			saved?.scripts.map((s) => [s.role, s.content]),
			[
				["step", "return 42;"],
				["params", '{"a":1}'],
				["kit", "KIT"],
			],
		);
	});

	it("un fallo del script también es un intento (error); uno de contrato, contract_error", async () => {
		const { gateway, attemptLog, run } = setup();
		gateway.runReply = async () => err(scriptError("boom", 2, false));
		await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		gateway.runReply = async () =>
			ok({ createdNodeIds: [1], mutatedNodeIds: [] });
		await run({
			source: code("// @contract step@1 · x\nreturn 1"),
			format: SCRIPT_FORMAT.body,
		});
		assert.deepEqual(
			attemptLog.recorded.map((a) => [a.target, a.status]),
			[
				["(código)", "error"],
				["(código)", "contract_error"],
			],
		);
	});

	it("lo que no llegó a enviarse (ruta ilegible, pestaña sin sesión) no es un intento", async () => {
		const { gateway, attemptLog, run } = setup();
		await run({
			source: { kind: "file", path: "no-hay.js" },
			format: SCRIPT_FORMAT.body,
		});
		gateway.readyReply = async () =>
			err(figmaNotReady(0, FIGMA_NOT_READY_REASON.notLoggedIn));
		await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.deepEqual(attemptLog.recorded, []);
	});

	it("un script que pasa del plazo blando y acaba siendo un job guarda el jobId", async () => {
		const { gateway, attemptLog, jobs, run } = setup({ softDeadlineMs: 20 });
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.equal(r.kind, "running");
		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(
			attemptLog.recorded[0]?.jobId,
			r.kind === "running" ? r.jobId : "",
		);
		void jobs;
	});

	it("un fallo del registro no rompe el script", async () => {
		const { gateway, attemptLog, run } = setup();
		attemptLog.failing = true;
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const r = await run({ source: code("x"), format: SCRIPT_FORMAT.body });
		assert.ok(r.kind === "finished" && r.outcome.ok);
	});
});
