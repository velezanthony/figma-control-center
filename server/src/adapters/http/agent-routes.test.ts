import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeAgentWatchHub } from "#application/agent-watch-hub.ts";
import { InMemoryAgentLaunches } from "#application/testing/in-memory-agent-launches.ts";
import type { AgentLaunchError, AgentLaunched } from "#domain/agent.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { handleAgentRequest, openAgentWatch } from "./agent-routes.ts";
import type { ApiRequest } from "./request-guard.ts";

const HOSTS = ["127.0.0.1:4173", "localhost:4173"];
const LAUNCHED: AgentLaunched = {
	launchId: "abc",
	startedAt: "2026-01-01T10:00:00.000Z",
	timeoutMs: 120_000,
};

function setup(
	outcome: Result<AgentLaunched, AgentLaunchError> = ok(LAUNCHED),
) {
	let launches = 0;
	const projectsAsked: string[] = [];
	const deps = {
		launch: (projectId: string) => {
			launches++;
			projectsAsked.push(projectId);
			return Promise.resolve(outcome);
		},
		projectIds: () => Promise.resolve(["1", "2"]),
		watch: makeAgentWatchHub({
			launches: new InMemoryAgentLaunches(),
			isAlive: () => true,
		}),
		allowedHosts: HOSTS,
	};
	const raw = (over: Partial<ApiRequest> = {}) =>
		handleAgentRequest(deps, {
			method: "POST",
			pathname: "/api/agent/launch",
			params: new URLSearchParams("project=1"),
			headers: {
				host: HOSTS[0],
				"content-type": "application/json",
				origin: `http://${HOSTS[0]}`,
			},
			body: "",
			...over,
		});
	const call = async (over: Partial<ApiRequest> = {}) => {
		const response = await raw(over);
		assert.ok(response, "debería ser una ruta del agente");
		return response;
	};
	return { raw, call, launches: () => launches, projectsAsked };
}

const withHeaders = (extra: Record<string, string | undefined>) => ({
	host: HOSTS[0],
	"content-type": "application/json",
	origin: `http://${HOSTS[0]}`,
	...extra,
});

describe("handleAgentRequest", () => {
	it("una ruta que no es del agente no la maneja", async () => {
		const { raw } = setup();
		assert.equal(await raw({ pathname: "/api/chat/sessions" }), null);
	});

	it("POST /api/agent/launch lanza y responde 202 con id, hora y plazo del lanzamiento, sin pid", async () => {
		const { call, launches } = setup();
		const r = await call();
		assert.deepEqual(r, { status: 202, body: { ok: true, ...LAUNCHED } });
		assert.equal(launches(), 1);
	});

	it("no acepta argumentos: ni cuerpo ni parámetros de URL llegan a lanzar nada", async () => {
		const { call, launches } = setup();
		for (const over of [
			{ body: '{"command":"rm -rf /"}' },
			{ body: "{}" },
			{ body: "make agent" },
			{ params: new URLSearchParams("cmd=ls") },
		]) {
			const r = await call(over);
			assert.equal(r.status, 400, JSON.stringify(over));
			assert.equal(
				(r.body as { error: { type: string } }).error.type,
				"ArgumentsNotAllowed",
			);
		}
		assert.equal(launches(), 0);
	});

	it("sin ?project no lanza: 400 ProjectRequired (nunca un agente que vea todos los proyectos)", async () => {
		const { call, launches } = setup();
		const r = await call({ params: new URLSearchParams() });
		assert.equal(r.status, 400);
		assert.equal(
			(r.body as { error: { type: string } }).error.type,
			"ProjectRequired",
		);
		assert.equal(launches(), 0);
	});

	it("con ?project=<id> de un proyecto que existe, lanza el agente de ESE proyecto", async () => {
		const { call, projectsAsked } = setup();
		const r = await call({ params: new URLSearchParams("project=2") });
		assert.equal(r.status, 202);
		assert.deepEqual(projectsAsked, ["2"]);
	});

	it("un proyecto con raíces peligrosas es 409 con el motivo, y uno que desapareció al lanzar, 404", async () => {
		const unsafe = setup(
			err({
				type: "UnsafeProjectPaths",
				message: "la raíz «/» es la raíz del sistema",
			}),
		);
		const r = await unsafe.call();
		assert.equal(r.status, 409);
		assert.deepEqual(r.body, {
			ok: false,
			error: {
				type: "UnsafeProjectPaths",
				message: "la raíz «/» es la raíz del sistema",
			},
		});
		const gone = setup(
			err({ type: "ProjectNotAvailable", message: "no está" }),
		);
		assert.equal((await gone.call()).status, 404);
	});

	it("un proyecto que no existe es 404 y no lanza nada", async () => {
		const { call, launches } = setup();
		const r = await call({ params: new URLSearchParams("project=otro") });
		assert.equal(r.status, 404);
		assert.equal(
			(r.body as { error: { type: string } }).error.type,
			"ProjectNotAvailable",
		);
		assert.equal(launches(), 0);
	});

	it("?project no abre la puerta a otros parámetros ni a un cuerpo", async () => {
		const { call, launches } = setup();
		for (const over of [
			{ params: new URLSearchParams("project=1&cmd=ls") },
			{ params: new URLSearchParams("project=1"), body: "{}" },
		]) {
			assert.equal((await call(over)).status, 400);
		}
		assert.equal(launches(), 0);
	});

	it("rechaza otro origen, otro Host, una petición cross-site y un tipo que no es JSON", async () => {
		const { call, launches } = setup();
		const cases: [Record<string, string | undefined>, number][] = [
			[{ origin: "https://malo.example" }, 403],
			[{ origin: "http://127.0.0.1:9999" }, 403],
			[{ host: "malo.example:4173" }, 403],
			[{ "sec-fetch-site": "cross-site" }, 403],
			[{ "content-type": "text/plain" }, 415],
			[{ "content-type": "application/x-www-form-urlencoded" }, 415],
			[{ "content-type": undefined }, 415],
		];
		for (const [extra, status] of cases) {
			const r = await call({ headers: withHeaders(extra) });
			assert.equal(r.status, status, JSON.stringify(extra));
		}
		assert.equal(launches(), 0);
	});

	it("sin Origin (curl local) con JSON y Host local sí vale", async () => {
		const { call } = setup();
		const r = await call({ headers: withHeaders({ origin: undefined }) });
		assert.equal(r.status, 202);
	});

	it("solo POST: cualquier otro método es 405 y no lanza", async () => {
		const { call, launches } = setup();
		for (const method of ["GET", "PUT", "DELETE"]) {
			assert.equal((await call({ method })).status, 405, method);
		}
		assert.equal(launches(), 0);
	});

	it("un lanzamiento en curso es 409", async () => {
		const { call } = setup(
			err({ type: "LaunchInProgress", message: "ya hay uno" }),
		);
		const r = await call();
		assert.equal(r.status, 409);
		assert.deepEqual(r.body, {
			ok: false,
			error: { type: "LaunchInProgress", message: "ya hay uno" },
		});
	});

	it("una terminal que no existe o un fallo al abrirla son 500 con el motivo claro", async () => {
		const missing = setup(
			err({ type: "TerminalNotFound", message: "No se encontró la terminal" }),
		);
		const r = await missing.call();
		assert.equal(r.status, 500);
		assert.match(
			(r.body as { error: { message: string } }).error.message,
			/terminal/,
		);
		const failed = setup(err({ type: "LaunchFailed", message: "EACCES" }));
		assert.equal((await failed.call()).status, 500);
	});

	it("cualquier otra ruta bajo /api/agent/ es 404", async () => {
		const { call, launches } = setup();
		assert.equal((await call({ pathname: "/api/agent/otra" })).status, 404);
		assert.equal(launches(), 0);
	});
});

// Un lanzamiento vivo del proyecto 1 y otro muerto, con su vigilancia
const LIVE = "6e9b6885-0000-4000-8000-000000000001";
const DEAD = "6e9b6885-0000-4000-8000-000000000003";
const ALIVE_PID = 100;

function watchSetup() {
	const launches = new InMemoryAgentLaunches();
	for (const [id, pid] of [
		[LIVE, ALIVE_PID],
		[DEAD, 200],
	] as const) {
		launches.create(launches.pathFor(id), {
			settings: {},
			mcpConfig: {},
			launch: {
				projectId: "1",
				args: [],
				cwd: "/srv/a",
				env: {},
				guard: { repoRoot: "/repo", roots: ["/srv/a"], denied: [] },
				pid,
			},
		});
	}
	const hub = makeAgentWatchHub({
		launches,
		isAlive: (pid) => pid === ALIVE_PID,
	});
	let closes = 0;
	const link = { sendClose: () => closes++ };
	const deps = {
		launch: () => Promise.resolve(ok(LAUNCHED)),
		projectIds: () => Promise.resolve(["1", "2"]),
		watch: hub,
		allowedHosts: HOSTS,
	};
	const request = (over: Partial<ApiRequest> = {}): ApiRequest => ({
		method: "GET",
		pathname: "/api/agent/watch",
		params: new URLSearchParams(`launch=${LIVE}`),
		headers: withHeaders({}),
		body: "",
		...over,
	});
	const watch = (over: Partial<ApiRequest> = {}) =>
		openAgentWatch(deps, request(over), link);
	const close = async (over: Partial<ApiRequest> = {}) => {
		const r = await handleAgentRequest(
			deps,
			request({ method: "POST", pathname: "/api/agent/close", ...over }),
		);
		assert.ok(r);
		return r;
	};
	const listed = async (query: string) => {
		const r = await handleAgentRequest(
			deps,
			request({
				pathname: "/api/agent/launches",
				params: new URLSearchParams(query),
				headers: { host: HOSTS[0] },
			}),
		);
		assert.ok(r);
		return r;
	};
	return { watch, close, listed, closes: () => closes };
}

const errorType = (r: unknown) =>
	(r as { body: { error: { type: string } } }).body.error.type;

describe("GET /api/agent/watch: la vigilancia del agente", () => {
	it("con un lanzamiento vivo queda abierta sin mandar nada", () => {
		const { watch, closes } = watchSetup();
		const r = watch();
		assert.ok("release" in r, JSON.stringify(r));
		assert.equal(closes(), 0);
	});

	it("un lanzamiento desconocido, de pid muerto o con un id que no lo es, es 404", () => {
		const { watch } = watchSetup();
		for (const id of [
			"6e9b6885-0000-4000-8000-00000000ffff",
			DEAD,
			"../../etc",
			"",
		]) {
			const r = watch({ params: new URLSearchParams(`launch=${id}`) });
			assert.ok(!("release" in r), id);
			assert.equal(r.status, 404, id);
			assert.equal(errorType(r), "UnknownLaunch", id);
		}
	});

	it("rechaza Host, origen ajeno, cross-site, un tipo que no es JSON, cuerpo y parámetros de más (CA-7)", () => {
		const { watch } = watchSetup();
		const cases: [Partial<ApiRequest>, number][] = [
			[{ headers: withHeaders({ host: "malo.example:4173" }) }, 403],
			[{ headers: withHeaders({ origin: "https://malo.example" }) }, 403],
			[{ headers: withHeaders({ "sec-fetch-site": "cross-site" }) }, 403],
			[{ headers: withHeaders({ "content-type": "text/plain" }) }, 415],
			[{ body: "{}" }, 400],
			[{ params: new URLSearchParams(`launch=${LIVE}&cmd=ls`) }, 400],
			[{ params: new URLSearchParams() }, 400],
			[{ method: "POST" }, 405],
		];
		for (const [over, status] of cases) {
			const r = watch(over);
			assert.ok(!("release" in r), JSON.stringify(over));
			assert.equal(r.status, status, JSON.stringify(over));
		}
	});
});

describe("POST /api/agent/close: el botón «Cerrar agente»", () => {
	it("manda un único close por la conexión de ese lanzamiento y responde 202", async () => {
		const { watch, close, closes } = watchSetup();
		watch();
		assert.deepEqual(await close(), { status: 202, body: { ok: true } });
		assert.equal(closes(), 1);
		assert.equal((await close()).status, 409);
		assert.equal(closes(), 1);
	});

	it("un lanzamiento vivo sin vigilancia abierta es 409 y no manda nada", async () => {
		const { close, closes } = watchSetup();
		const r = await close();
		assert.equal(r.status, 409);
		assert.equal(errorType(r), "AgentNotWatching");
		assert.equal(closes(), 0);
	});

	it("un lanzamiento desconocido o muerto es 404 y no manda nada", async () => {
		const { watch, close, closes } = watchSetup();
		watch();
		for (const id of [DEAD, "6e9b6885-0000-4000-8000-00000000ffff", "x"]) {
			const r = await close({ params: new URLSearchParams(`launch=${id}`) });
			assert.equal(r.status, 404, id);
			assert.equal(errorType(r), "UnknownLaunch", id);
		}
		assert.equal(closes(), 0);
	});

	it("rechaza Host, origen ajeno, cuerpo, parámetros de más y otro método, sin mandar nada (CA-7)", async () => {
		const { watch, close, closes } = watchSetup();
		watch();
		const cases: [Partial<ApiRequest>, number][] = [
			[{ headers: withHeaders({ host: "malo.example:4173" }) }, 403],
			[{ headers: withHeaders({ origin: "http://127.0.0.1:9999" }) }, 403],
			[{ headers: withHeaders({ "sec-fetch-site": "cross-site" }) }, 403],
			[{ headers: withHeaders({ "content-type": undefined }) }, 415],
			[{ body: '{"launch":"x"}' }, 400],
			[{ params: new URLSearchParams(`launch=${LIVE}&project=1`) }, 400],
			[{ params: new URLSearchParams() }, 400],
			[{ method: "GET" }, 405],
		];
		for (const [over, status] of cases) {
			assert.equal((await close(over)).status, status, JSON.stringify(over));
		}
		assert.equal(closes(), 0);
	});
});

describe("GET /api/agent/launches: qué agente del proyecto puede cerrar el botón", () => {
	it("lista los lanzamientos vivos y vigilando de ese proyecto", async () => {
		const { watch, listed } = watchSetup();
		assert.deepEqual(await listed("project=1"), {
			status: 200,
			body: { ok: true, items: [] },
		});
		watch();
		assert.deepEqual(await listed("project=1"), {
			status: 200,
			body: { ok: true, items: [{ launchId: LIVE }] },
		});
		assert.deepEqual((await listed("project=2")).body, {
			ok: true,
			items: [],
		});
	});

	it("sin ?project o con parámetros de más es 400", async () => {
		const { listed } = watchSetup();
		for (const q of ["", "project=", "project=1&x=1"]) {
			assert.equal((await listed(q)).status, 400, q);
		}
	});
});
