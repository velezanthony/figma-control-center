import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ATTEMPT_KIND,
	ATTEMPT_ROLE,
	ATTEMPT_STATUS,
	CODE_TARGET,
} from "#domain/attempt.ts";
import {
	callTimeout,
	chromeUnreachable,
	figmaNotReady,
	figmaTabNotFound,
	scriptError,
	stepContractError,
} from "#domain/figma-error.ts";
import { makeAttemptRecorder } from "./record-attempt.ts";
import { InMemoryAttemptLog } from "./testing/in-memory-attempt-log.ts";
import {
	InMemoryAssetRepository,
	InMemoryScriptRepository,
} from "./testing/in-memory-ports.ts";

function setup() {
	const log = new InMemoryAttemptLog();
	const scripts = new InMemoryScriptRepository();
	const assets = new InMemoryAssetRepository();
	const warnings: string[] = [];
	let tick = 0;
	const record = makeAttemptRecorder({
		log,
		scripts,
		assets,
		clock: () => new Date(1_000 * ++tick),
		kits: {
			figma: () => ({ version: "figma-kit@1", content: "KIT-FIGMA" }),
			capture: () => ({ version: "capture-kit@1", content: "KIT-CAPTURA" }),
		},
		warn: (m) => warnings.push(m),
	});
	return { log, scripts, assets, record, warnings };
}

const roles = (a: { scripts: readonly { role: string; content: string }[] }) =>
	Object.fromEntries(a.scripts.map((s) => [s.role, s.content]));

describe("makeAttemptRecorder", () => {
	it("un script de fichero: el objetivo es su identidad (ruta relativa a su raíz), con step, params y kit", async () => {
		const { log, scripts, record } = setup();
		scripts.identity = async () => "pasos/a.js";
		const run = record.start({
			kind: ATTEMPT_KIND.runScript,
			source: { kind: "file", path: "/abs/scripts/pasos/a.js" },
			step: "return 1;",
			params: { a: 1 },
			callId: "call-1",
		});
		await run.finish({ ok: true });
		const [saved] = log.recorded;
		assert.equal(saved?.kind, "run_script");
		assert.equal(saved?.target, "pasos/a.js");
		assert.equal(saved?.status, ATTEMPT_STATUS.ok);
		assert.equal(saved?.callId, "call-1");
		assert.equal(saved?.kit, "figma-kit@1");
		assert.deepEqual(roles(saved ?? { scripts: [] }), {
			step: "return 1;",
			params: '{"a":1}',
			kit: "KIT-FIGMA",
		});
		assert.equal(saved?.startedAt.getTime(), 1000);
		assert.equal(saved?.finishedAt.getTime(), 2000);
	});

	it("un `code` suelto tiene el objetivo «(código)»; sin params no guarda el papel params", async () => {
		const { log, record } = setup();
		await record
			.start({
				kind: ATTEMPT_KIND.runScript,
				source: { kind: "code" },
				step: "1",
			})
			.finish({ ok: true });
		assert.equal(log.recorded[0]?.target, CODE_TARGET);
		assert.equal(
			ATTEMPT_ROLE.params in roles(log.recorded[0] ?? { scripts: [] }),
			false,
		);
	});

	it("un paso de lote guarda el job y el índice; los assets, descritos y sin bytes", async () => {
		const { log, assets, record } = setup();
		assets.files.set("a/datos.json", Uint8Array.from([1, 2]));
		await record
			.start({
				kind: ATTEMPT_KIND.buildStep,
				source: { kind: "file", path: "build.js" },
				step: "x",
				assets: { datos: "a/datos.json" },
				callId: "c",
				jobId: "job-9",
				stepIndex: 2,
			})
			.finish({ ok: true });
		const saved = log.recorded[0];
		assert.equal(saved?.jobId, "job-9");
		assert.equal(saved?.stepIndex, 2);
		assert.deepEqual(saved?.assets, [
			{
				name: "datos",
				path: "a/datos.json",
				bytes: 2,
				sha256: "sha:a/datos.json",
			},
		]);
	});

	it("el job que se conoce al acabar (un script lento) se añade en finish", async () => {
		const { log, record } = setup();
		await record
			.start({
				kind: ATTEMPT_KIND.runScript,
				source: { kind: "code" },
				step: "x",
			})
			.finish({ ok: true }, { jobId: "job-3" });
		assert.equal(log.recorded[0]?.jobId, "job-3");
	});

	it("un ContractError es contract_error y un fallo del script es error, con su primer mensaje", async () => {
		const { log, record } = setup();
		const start = () =>
			record.start({
				kind: ATTEMPT_KIND.runScript,
				source: { kind: "code" },
				step: "x",
			});
		await start().finish({
			ok: false,
			error: stepContractError([
				{ pointer: "/createdNodeIds/0", message: "no es texto" },
			]),
		});
		await start().finish({ ok: false, error: scriptError("boom", 3, false) });
		await start().finish({ ok: false, error: callTimeout(500) });
		assert.deepEqual(
			log.recorded.map((a) => a.status),
			["contract_error", "error", "error"],
		);
		assert.match(log.recorded[0]?.firstError ?? "", /createdNodeIds/);
		assert.equal(log.recorded[1]?.firstError, "boom");
	});

	it("lo que falló antes de enviar el script a la pestaña no es un intento", async () => {
		const { log, record } = setup();
		const start = () =>
			record.start({
				kind: ATTEMPT_KIND.runScript,
				source: { kind: "code" },
				step: "x",
			});
		await start().finish({
			ok: false,
			error: chromeUnreachable("localhost:9222"),
		});
		await start().finish({ ok: false, error: figmaTabNotFound("https://x") });
		await start().finish({ ok: false, error: figmaNotReady(0) });
		assert.deepEqual(log.recorded, []);
	});

	it("una captura: el objetivo es la clave de la pantalla; guarda ganchos, su entrada de screens@1 y el kit de captura", async () => {
		const { log, record } = setup();
		await record
			.start({
				kind: ATTEMPT_KIND.capture,
				source: { kind: "key", key: "inicio" },
				hooks: { path: "hooks.js", content: "export default {}" },
				screens: { content: '{"key":"inicio"}' },
				startedAt: new Date(5),
			})
			.finish({ ok: true });
		const saved = log.recorded[0];
		assert.equal(saved?.target, "inicio");
		assert.equal(saved?.kit, "capture-kit@1");
		assert.deepEqual(roles(saved ?? { scripts: [] }), {
			hooks: "export default {}",
			screens: '{"key":"inicio"}',
			kit: "KIT-CAPTURA",
		});
		assert.equal(
			saved?.scripts.find((s) => s.role === "hooks")?.path,
			"hooks.js",
		);
		assert.equal(saved?.startedAt.getTime(), 5);
	});

	it("un paso que pinta una pantalla guarda además el plan, el map.json y el módulo de reconocimiento", async () => {
		const { log, record } = setup();
		await record
			.start({
				kind: ATTEMPT_KIND.buildStep,
				source: { kind: "key", key: "kit/build-screen@1 · home" },
				step: "STEP",
				params: { screen: "home" },
				plan: { content: '{"screen":"home"}' },
				map: { path: "/p/map.json", content: '{"contract":"map@1"}' },
				recognize: { path: "/p/recognize.js", content: "({})" },
			})
			.finish({ ok: true });
		const saved = log.recorded[0];
		assert.deepEqual(
			saved?.scripts.map((s) => s.role),
			["step", "params", "kit", "map", "plan", "recognize"],
		);
		assert.equal(saved?.scripts.find((s) => s.role === "plan")?.path, "");
		assert.equal(
			saved?.scripts.find((s) => s.role === "map")?.path,
			"/p/map.json",
		);
		assert.equal(
			saved?.scripts.find((s) => s.role === "recognize")?.content,
			"({})",
		);
	});

	it("registrar es accesorio: un fallo del registro o del kit se avisa y no lanza", async () => {
		const { log, record, warnings } = setup();
		log.failing = true;
		await record
			.start({
				kind: ATTEMPT_KIND.runScript,
				source: { kind: "code" },
				step: "x",
			})
			.finish({ ok: true });
		const broken = makeAttemptRecorder({
			log,
			scripts: new InMemoryScriptRepository(),
			assets: new InMemoryAssetRepository(),
			clock: () => new Date(),
			kits: {
				figma: () => {
					throw new Error("sin kit");
				},
				capture: () => ({ version: "c", content: "c" }),
			},
			warn: (m) => warnings.push(m),
		});
		await broken
			.start({
				kind: ATTEMPT_KIND.runScript,
				source: { kind: "code" },
				step: "x",
			})
			.finish({ ok: true });
		assert.match(warnings.join("\n"), /sin kit/);
	});
});
