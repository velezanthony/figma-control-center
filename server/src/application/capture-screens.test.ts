import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Screen } from "#domain/capture.ts";
import { CAPTURE_ISSUE } from "#domain/capture-check.ts";
import {
	projectConfigError,
	secretMissing,
	WEB_PAGE_REASON,
	webPageError,
} from "#domain/figma-error.ts";
import { JOB_STATUS, toJobId } from "#domain/job.ts";
import { nodeId } from "#domain/node-id.ts";
import { err } from "#domain/result.ts";
import {
	type CaptureReport,
	type CaptureRun,
	type CaptureScreensDeps,
	makeCaptureScreens,
} from "./capture-screens.ts";
import { createJobRegistry, localBuildLock } from "./job-registry.ts";
import { makeAttemptRecorder } from "./record-attempt.ts";
import { InMemoryAttemptLog } from "./testing/in-memory-attempt-log.ts";
import { deferred } from "./testing/in-memory-figma-gateway.ts";
import {
	InMemoryAssetRepository,
	InMemoryScriptRepository,
} from "./testing/in-memory-ports.ts";
import {
	capturedScreen,
	InMemoryProjectConfig,
	InMemorySecrets,
	InMemoryWebCapturer,
	InMemoryWebCaptureStore,
	projectWith,
	textNode,
} from "./testing/in-memory-web-capture.ts";

const HOME: Screen = { key: "inicio", title: "Inicio", url: "/" };
const PRIVATE: Screen = {
	key: "panel",
	title: "Panel",
	url: "/privado/",
	session: "lector",
};
const PAGE_WORLD: Screen = {
	key: "menu",
	title: "Menú",
	url: "/",
	variants: [
		{
			props: { menu: "abierto" },
			run: [{ evaluateInPage: "app.open = true" }],
		},
	],
};
const USERS = { lector: { username: "lector", secretRef: "qa-lector" } };
const LOCAL_ISO = "2026-11-11T10:00:00.000+01:00";

function setup(
	over: Partial<CaptureScreensDeps> = {},
	screens = [HOME, PRIVATE, PAGE_WORLD],
) {
	const project = new InMemoryProjectConfig(
		projectWith(
			screens,
			{ users: USERS },
			{ source: "({})", sha256: "c".repeat(64) },
		),
	);
	const secrets = new InMemorySecrets();
	secrets.values.set("qa-lector", "clave-secreta");
	const capturer = new InMemoryWebCapturer();
	const store = new InMemoryWebCaptureStore();
	let n = 0;
	const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
	const finished: unknown[] = [];
	const attemptLog = new InMemoryAttemptLog();
	const deps: CaptureScreensDeps = {
		attempts: makeAttemptRecorder({
			log: attemptLog,
			scripts: new InMemoryScriptRepository(),
			assets: new InMemoryAssetRepository(),
			clock: () => new Date("2026-11-11T09:00:00Z"),
			kits: {
				figma: () => ({ version: "figma-kit@1", content: "KIT-FIGMA" }),
				capture: () => ({ version: "capture-kit@1", content: "KIT-CAPTURA" }),
			},
			warn: (m) => assert.fail(m),
		}),
		project,
		secrets,
		capturer,
		store,
		lock: localBuildLock(),
		jobs,
		softDeadlineMs: 5000,
		pageTimeoutMs: 1000,
		captureMaxBytes: 1_000_000,
		inlineErrors: 2,
		checkSchema: () => [],
		clock: () => new Date("2026-11-11T09:00:00Z"),
		localIso: () => LOCAL_ISO,
		onJobFinished: (j) => finished.push(j),
		...over,
	};
	return {
		capture: makeCaptureScreens(deps),
		deps,
		project,
		secrets,
		capturer,
		store,
		jobs,
		finished,
		attemptLog,
	};
}

const report = (run: CaptureRun): CaptureReport => {
	assert.equal(run.kind, "finished", JSON.stringify(run));
	if (run.kind !== "finished") throw new Error();
	assert.ok(run.outcome.ok, run.outcome.ok ? "" : run.outcome.error.message);
	return run.outcome.value;
};

describe("capturar pantallas: antes de abrir nada", () => {
	it("una configuración que no vale es su error y no se lanza Chrome ni se leen secretos", async () => {
		const { capture, project, capturer, secrets } = setup();
		project.reply = async () =>
			err(projectConfigError("/p/x.json", "web.baseUrl", "falta"));
		const run = await capture({ screens: ["inicio"] });
		assert.equal(run.kind, "finished");
		assert.equal(run.kind === "finished" && run.jobId, null);
		assert.equal(
			run.kind === "finished" && !run.outcome.ok && run.outcome.error.type,
			"ProjectConfigError",
		);
		assert.equal(capturer.requests.length, 0);
		assert.equal(secrets.calls.length, 0);
	});

	it("una pantalla que no está en screens@1 es un error de uso que la nombra", async () => {
		const { capture, capturer } = setup();
		const run = await capture({ screens: ["inicio", "no-existe"] });
		assert.equal(run.kind, "usage");
		assert.match(
			run.kind === "usage" ? run.message : "",
			/no-existe[\s\S]*inicio/,
		);
		assert.equal(capturer.requests.length, 0);
	});

	it("evaluateInPage sin allowPageWorld es un error de uso que nombra esas pantallas; con él se captura", async () => {
		const { capture, capturer } = setup();
		const refused = await capture({ screens: ["inicio", "menu"] });
		assert.equal(refused.kind, "usage");
		assert.match(
			refused.kind === "usage" ? refused.message : "",
			/allowPageWorld[\s\S]*menu/,
		);
		assert.doesNotMatch(
			refused.kind === "usage" ? refused.message : "",
			/inicio/,
		);
		assert.equal(capturer.requests.length, 0);
		report(await capture({ screens: ["menu"], allowPageWorld: true }));
		assert.equal(capturer.requests[0]?.allowPageWorld, true);
	});

	it("un secretRef sin valor es SecretMissing antes de lanzar Chrome", async () => {
		const { capture, secrets, capturer } = setup();
		secrets.reply = async () => err(secretMissing("qa-lector", "/s.json"));
		const run = await capture({ screens: ["panel"] });
		assert.equal(
			run.kind === "finished" && !run.outcome.ok && run.outcome.error.type,
			"SecretMissing",
		);
		assert.equal(capturer.requests.length, 0);
	});

	it("solo se piden los secretos de los usuarios de las pantallas pedidas", async () => {
		const { capture, secrets } = setup();
		report(await capture({ screens: ["inicio"] }));
		assert.deepEqual(secrets.calls, [[]]);
		report(await capture({ screens: ["panel"] }));
		assert.deepEqual(secrets.calls[1], ["qa-lector"]);
	});

	it("con otra captura en marcha en la máquina es un error de uso y no se lanza nada", async () => {
		const lock = localBuildLock();
		const { capture, capturer } = setup({ lock });
		assert.ok(lock.acquire(toJobId("otra")));
		const run = await capture({ screens: ["inicio"] });
		assert.equal(run.kind, "usage");
		assert.match(
			run.kind === "usage" ? run.message : "",
			/otra captura de la web/,
		);
		assert.equal(capturer.requests.length, 0);
	});
});

describe("capturar pantallas: lo que se pide al Chrome de captura", () => {
	it("la escala y el dpr por defecto son 1; cada usuario va con su contraseña resuelta en memoria", async () => {
		const { capture, capturer } = setup();
		report(await capture({ screens: ["panel"] }));
		const req = capturer.requests[0];
		assert.equal(req?.web.screenScale, 1);
		assert.equal(req?.web.devicePixelRatio, 1);
		assert.deepEqual(req?.users.get("lector"), {
			username: "lector",
			password: "clave-secreta",
		});
		assert.equal(req?.hooks, "({})");
		assert.equal(req?.pageTimeoutMs, 1000);
	});
});

describe("capturar pantallas: guardar y juzgar con el contrato", () => {
	it("una captura válida se guarda con ids desde la ruta, sin anotaciones, y el resumen trae los conteos (no el árbol)", async () => {
		const { capture, store } = setup();
		const r = report(await capture({ screens: ["inicio"] }));
		assert.equal(r.error, null);
		assert.equal(r.files.length, 1);
		const saved = JSON.parse(
			store.captures.get(r.files[0]?.path ?? "") ?? "{}",
		);
		assert.equal(saved.contract, "capture@1");
		assert.equal(saved.variants[0].nodes[0].id, nodeId("p[0]"));
		assert.deepEqual(saved.variants[0].annotations, []);
		assert.deepEqual(saved.source.hooks, { sha256: "c".repeat(64) });
		assert.equal(saved.source.capturedAt, LOCAL_ISO);
		assert.equal(saved.source.kit, "capture-kit@1");
		assert.deepEqual(r.summary, ["inicio: 1 variante, 1 nodo, 0 imágenes"]);
		assert.doesNotMatch(JSON.stringify(r), /"txt"/);
	});

	it("las imágenes se guardan una vez por sha256 y la captura las lleva por ref", async () => {
		const { capture, capturer, store } = setup();
		const image = {
			sha256: "d".repeat(64),
			bytes: new Uint8Array([1]),
			width: 2,
			height: 3,
			type: "png" as const,
		};
		capturer.screens.set(
			"inicio",
			capturedScreen(
				"inicio",
				[{ t: "img", path: "img[0]", ref: image.sha256, w: 2, h: 3 }],
				[image],
			),
		);
		const r = report(await capture({ screens: ["inicio"] }));
		assert.ok(store.images.has(image.sha256));
		const saved = JSON.parse(
			store.captures.get(r.files[0]?.path ?? "") ?? "{}",
		);
		assert.deepEqual(saved.images[image.sha256], {
			path: `img/${image.sha256}.png`,
			width: 2,
			height: 3,
			type: "png",
		});
		assert.deepEqual(r.summary, ["inicio: 1 variante, 1 nodo, 1 imagen"]);
	});

	it("una captura que no cumple va a rejected/ con sus errores (código, id y ruta) y no como válida", async () => {
		const { capture, capturer, store } = setup();
		capturer.screens.set(
			"inicio",
			capturedScreen("inicio", [textNode("p[0]", { w: -1 })]),
		);
		const r = report(await capture({ screens: ["inicio"] }));
		assert.equal(r.files.length, 0);
		assert.equal(store.captures.size, 0);
		assert.equal(r.rejected.length, 1);
		assert.equal(r.error?.type, "ContractError");
		assert.deepEqual(
			r.errors.map((e) => [e.screen, e.code, e.nodeId, e.path]),
			[["inicio", CAPTURE_ISSUE.badBox, nodeId("p[0]"), "p[0]"]],
		);
		const errorsFile = JSON.parse(
			store.rejected.get(r.rejected[0]?.path ?? "")?.errors ?? "[]",
		);
		assert.equal(errorsFile.length, 1);
	});

	it("lo que dice el esquema también rechaza la captura", async () => {
		const { capture, store } = setup({
			checkSchema: () => [
				{ code: CAPTURE_ISSUE.schema, message: "clave de más", path: "p[0]" },
			],
		});
		const r = report(await capture({ screens: ["inicio"] }));
		assert.equal(r.rejected.length, 1);
		assert.equal(store.captures.size, 0);
		assert.deepEqual(
			r.errors.map((e) => e.code),
			[CAPTURE_ISSUE.schema],
		);
	});

	it("los errores en la respuesta se recortan a FCC_CONTRACT_INLINE_ERRORS; el fichero los trae todos", async () => {
		const { capture, capturer, store } = setup({ inlineErrors: 2 });
		capturer.screens.set(
			"inicio",
			capturedScreen("inicio", [
				textNode("p[0]", { w: -1 }),
				textNode("p[1]", { w: -1 }),
				textNode("p[2]", { w: -1 }),
			]),
		);
		const r = report(await capture({ screens: ["inicio"] }));
		assert.equal(r.errors.length, 2);
		assert.equal(r.errorCount, 3);
		assert.equal(
			JSON.parse(store.rejected.get(r.rejected[0]?.path ?? "")?.errors ?? "[]")
				.length,
			3,
		);
	});

	it("una captura más grande que FCC_CAPTURE_MAX_BYTES va a rejected/", async () => {
		const { capture } = setup({ captureMaxBytes: 50 });
		const r = report(await capture({ screens: ["inicio"] }));
		assert.deepEqual(
			r.errors.map((e) => e.code),
			[CAPTURE_ISSUE.tooLarge],
		);
	});

	it("un fallo de la página a mitad deja guardado lo ya capturado y trae el error", async () => {
		const { capture, capturer } = setup();
		capturer.finalReply = err(
			webPageError(WEB_PAGE_REASON.login, "sigue en /entrar/"),
		);
		const r = report(await capture({ screens: ["inicio"] }));
		assert.equal(r.files.length, 1);
		assert.equal(r.error?.type, "WebPageError");
	});
});

describe("capturar pantallas: flujo de jobs sin la pestaña de Figma", () => {
	it("queda como job terminado y avisa al acabar; el lock se suelta", async () => {
		const lock = localBuildLock();
		const { capture, jobs, finished } = setup({ lock });
		const run = await capture({ screens: ["inicio"] });
		assert.equal(run.kind, "finished");
		const jobId = run.kind === "finished" ? run.jobId : null;
		assert.ok(jobId);
		assert.equal(jobs.get(jobId)?.status, JOB_STATUS.done);
		assert.equal(finished.length, 1);
		assert.equal(lock.active(), undefined);
	});

	it("más allá del plazo blando responde running con su jobId y termina en segundo plano", async () => {
		const { capture, capturer, jobs } = setup({ softDeadlineMs: 1 });
		const gate = deferred<void>();
		capturer.gate = gate.promise;
		const run = await capture({ screens: ["inicio"] });
		assert.equal(run.kind, "running");
		const jobId = run.kind === "running" ? run.jobId : null;
		assert.ok(jobId);
		gate.resolve();
		await jobs.settleOf(jobId);
		assert.equal(jobs.get(jobId)?.status, JOB_STATUS.done);
	});

	it("un fallo de la captura queda como job fallido con su error", async () => {
		const { capture, capturer, jobs } = setup();
		capturer.finalReply = err(webPageError(WEB_PAGE_REASON.chrome, "puerto"));
		const run = await capture({ screens: ["inicio"] });
		const jobId = run.kind === "finished" ? run.jobId : null;
		assert.ok(jobId);
		assert.equal(jobs.get(jobId)?.status, JOB_STATUS.failed);
	});
});

describe("capturar pantallas: historial de intentos", () => {
	it("un intento por pantalla capturada: objetivo = su clave, con ganchos, su entrada de screens@1 y el kit de captura", async () => {
		const { capture, attemptLog } = setup();
		const run = await capture({ screens: ["inicio"], callId: "call-4" });
		report(run);
		const [saved] = attemptLog.recorded;
		assert.equal(attemptLog.recorded.length, 1);
		assert.equal(saved?.kind, "capture");
		assert.equal(saved?.target, "inicio");
		assert.equal(saved?.callId, "call-4");
		assert.equal(saved?.status, "ok");
		assert.equal(saved?.kit, "capture-kit@1");
		assert.equal(saved?.jobId, run.kind === "finished" ? run.jobId : "");
		assert.deepEqual(
			saved?.scripts.map((s) => [s.role, s.content]),
			[
				["kit", "KIT-CAPTURA"],
				["hooks", "({})"],
				["screens", JSON.stringify(HOME)],
			],
		);
	});

	it("una captura que no cumple el contrato es un intento contract_error", async () => {
		const { capture, capturer, attemptLog } = setup();
		capturer.screens.set(
			"inicio",
			capturedScreen("inicio", [textNode("p[0]", { w: -1 })]),
		);
		report(await capture({ screens: ["inicio"] }));
		assert.equal(attemptLog.recorded[0]?.status, "contract_error");
		assert.match(
			attemptLog.recorded[0]?.firstError ?? "",
			/rejected|capture@1/,
		);
	});

	it("capturar la misma pantalla dos veces cuenta 1 y 2", async () => {
		const { capture, attemptLog } = setup();
		report(await capture({ screens: ["inicio"] }));
		report(await capture({ screens: ["inicio"] }));
		assert.deepEqual(
			attemptLog.recorded.map((a) => a.n),
			[1, 2],
		);
	});

	it("una pantalla por intento: dos pantallas, dos intentos", async () => {
		const { capture, attemptLog } = setup();
		report(
			await capture({ screens: ["inicio", "menu"], allowPageWorld: true }),
		);
		assert.deepEqual(attemptLog.recorded.map((a) => a.target).sort(), [
			"inicio",
			"menu",
		]);
	});
});
