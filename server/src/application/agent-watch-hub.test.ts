import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeAgentWatchHub } from "./agent-watch-hub.ts";
import { InMemoryAgentLaunches } from "./testing/in-memory-agent-launches.ts";

const LIVE = "6e9b6885-0000-4000-8000-000000000001";
const OTHER = "6e9b6885-0000-4000-8000-000000000002";
const DEAD = "6e9b6885-0000-4000-8000-000000000003";
const ALIVE_PID = 100;
const DEAD_PID = 200;

function setup() {
	const launches = new InMemoryAgentLaunches();
	const add = (launchId: string, projectId: string, pid: number) =>
		launches.create(launches.pathFor(launchId), {
			settings: {},
			mcpConfig: {},
			launch: {
				projectId,
				args: [],
				cwd: "/srv/a",
				env: {},
				guard: { repoRoot: "/repo", roots: ["/srv/a"], denied: [] },
				pid,
			},
		});
	add(LIVE, "1", ALIVE_PID);
	add(OTHER, "2", ALIVE_PID);
	add(DEAD, "1", DEAD_PID);
	const hub = makeAgentWatchHub({
		launches,
		isAlive: (pid) => pid === ALIVE_PID,
	});
	// Una conexión de vigilancia: cuenta los `close` que recibe
	const link = () => {
		const got = { closes: 0 };
		return { got, link: { sendClose: () => got.closes++ } };
	};
	return { hub, launches, link };
}

describe("makeAgentWatchHub", () => {
	it("acepta la vigilancia de un lanzamiento vivo y no le manda nada", () => {
		const { hub, link } = setup();
		const l = link();
		assert.notEqual(hub.attach(LIVE, l.link), null);
		assert.equal(l.got.closes, 0);
	});

	it("rechaza la vigilancia de un lanzamiento desconocido, de pid muerto o con un id que no es de lanzamiento", () => {
		const { hub, link } = setup();
		for (const id of [
			"6e9b6885-0000-4000-8000-00000000ffff",
			DEAD,
			"../../etc",
			"",
		]) {
			assert.equal(hub.attach(id, link().link), null, id);
		}
	});

	it("close manda un único close por la conexión de ese lanzamiento, no a los demás", () => {
		const { hub, link } = setup();
		const mine = link();
		const other = link();
		hub.attach(LIVE, mine.link);
		hub.attach(OTHER, other.link);
		assert.deepEqual(hub.close(LIVE), { ok: true, value: undefined });
		assert.equal(mine.got.closes, 1);
		assert.equal(other.got.closes, 0);
		assert.equal(hub.close(LIVE).ok, false);
		assert.equal(mine.got.closes, 1);
	});

	it("close de un lanzamiento vivo sin conexión abierta dice que el agente no vigila", () => {
		const { hub } = setup();
		assert.deepEqual(hub.close(LIVE), {
			ok: false,
			error: {
				type: "AgentNotWatching",
				message:
					"El agente de este lanzamiento no está conectado al panel: ciérralo desde su terminal.",
			},
		});
	});

	it("close de un lanzamiento desconocido o muerto no manda nada", () => {
		const { hub, link } = setup();
		const l = link();
		hub.attach(LIVE, l.link);
		for (const id of [DEAD, "x"]) {
			const r = hub.close(id);
			assert.equal(r.ok, false);
			assert.equal(!r.ok && r.error.type, "UnknownLaunch");
		}
		assert.equal(l.got.closes, 0);
	});

	it("una conexión que se suelta deja de contar", () => {
		const { hub, link } = setup();
		const l = link();
		const release = hub.attach(LIVE, l.link);
		release?.();
		assert.equal(hub.close(LIVE).ok, false);
		assert.deepEqual(hub.watching("1"), []);
		assert.equal(l.got.closes, 0);
	});

	it("watching lista los lanzamientos vivos y conectados de un proyecto", () => {
		const { hub, link } = setup();
		assert.deepEqual(hub.watching("1"), []);
		hub.attach(LIVE, link().link);
		hub.attach(OTHER, link().link);
		assert.deepEqual(hub.watching("1"), [LIVE]);
		assert.deepEqual(hub.watching("2"), [OTHER]);
		assert.deepEqual(hub.watching("3"), []);
	});

	it("un lanzamiento cuyo lanzador muere deja de listarse aunque su conexión no se haya soltado aún", () => {
		const launches = new InMemoryAgentLaunches();
		let alive = true;
		launches.create(launches.pathFor(LIVE), {
			settings: {},
			mcpConfig: {},
			launch: {
				projectId: "1",
				args: [],
				cwd: "/srv/a",
				env: {},
				guard: { repoRoot: "/repo", roots: ["/srv/a"], denied: [] },
				pid: ALIVE_PID,
			},
		});
		const hub = makeAgentWatchHub({ launches, isAlive: () => alive });
		hub.attach(LIVE, { sendClose: () => {} });
		alive = false;
		assert.deepEqual(hub.watching("1"), []);
	});
});
