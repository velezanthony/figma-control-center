import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { err, ok, type Result } from "#domain/result.ts";
import { AGENT_COMMAND, makeLaunchAgent } from "./launch-agent.ts";
import type { PreparedLaunch, PrepareError } from "./prepare-agent-launch.ts";
import { InMemoryAgentLaunches } from "./testing/in-memory-agent-launches.ts";
import { InMemoryProcessSpawner } from "./testing/in-memory-process-spawner.ts";

const TIMEOUT_MS = 120_000;
const CWD = "/repo";

function setup(terminal: readonly string[] = ["gnome-terminal", "--"]) {
	let seq = 0;
	const spawner = new InMemoryProcessSpawner();
	const launches = new InMemoryAgentLaunches();
	const prepared: { projectId: string; launchId: string }[] = [];
	let prepareReply: Result<PreparedLaunch, PrepareError> | null = null;
	const alive = new Set<number>();
	let sessions: string[] = [];
	let now = 1_000;
	const launch = makeLaunchAgent({
		spawner,
		terminal,
		cwd: CWD,
		activeSessionIds: () => sessions,
		now: () => now,
		timeoutMs: TIMEOUT_MS,
		newId: () => `launch-${++seq}`,
		prepare: async (projectId, launchId) => {
			prepared.push({ projectId, launchId });
			if (prepareReply !== null) return prepareReply;
			const dir = launches.pathFor(launchId);
			const files = {
				settings: {},
				mcpConfig: {},
				launch: {
					projectId,
					args: [],
					cwd: "/srv/a",
					env: {},
					guard: { repoRoot: CWD, roots: ["/srv/a"], denied: [] },
					pid: 1,
				},
			};
			launches.create(dir, files);
			return ok({ dir, files });
		},
		launches,
		isAlive: (pid) => alive.has(pid),
	});
	return {
		spawner,
		launches,
		prepared,
		alive,
		launch,
		failPrepare: (e: PrepareError) => {
			prepareReply = err(e);
		},
		publish: (id: string) => {
			sessions = [...sessions, id];
		},
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("makeLaunchAgent", () => {
	it("prepara la carpeta del lanzamiento y abre la terminal con «make agent PROJECT=<id> AGENT_DIR=<carpeta>» en la raíz del repo", async () => {
		const { launch, spawner, prepared } = setup();
		const result = await launch("7");
		assert.deepEqual(result, {
			ok: true,
			value: {
				launchId: "launch-1",
				startedAt: new Date(1_000).toISOString(),
				timeoutMs: TIMEOUT_MS,
			},
		});
		assert.deepEqual(prepared, [{ projectId: "7", launchId: "launch-1" }]);
		assert.deepEqual(spawner.calls, [
			{
				argv: [
					"gnome-terminal",
					"--",
					"make",
					"agent",
					"PROJECT=7",
					"AGENT_DIR=/tmp/figma-agent-launch-1",
				],
				cwd: CWD,
			},
		]);
	});

	it("el comando es fijo: el argv sale de la configuración, del id con forma de id y de la carpeta que genera el panel", async () => {
		const { launch, spawner } = setup(["xterm", "-e"]);
		await launch("1");
		assert.deepEqual(spawner.calls[0]?.argv.slice(0, 4), [
			"xterm",
			"-e",
			...AGENT_COMMAND,
		]);
	});

	it("un id que no es un id de proyecto no llega nunca a la orden ni genera carpeta", async () => {
		for (const id of [
			"a b",
			"x;rm -rf",
			"--help",
			"PROJECT=../..",
			"",
			"ejemplo",
			"0",
			"32768",
			"07",
		]) {
			const { launch, spawner, prepared } = setup();
			const r = await launch(id);
			assert.equal(!r.ok && r.error.type, "InvalidProject", id);
			assert.deepEqual(spawner.calls, [], id);
			assert.deepEqual(prepared, [], id);
		}
	});

	it("un proyecto con raíces peligrosas no abre terminal y no bloquea el reintento", async () => {
		const { launch, spawner, failPrepare } = setup();
		failPrepare({
			type: "UnsafeProjectPaths",
			message: "la raíz «/» es la raíz del sistema",
		});
		const r = await launch("1");
		assert.deepEqual(r, {
			ok: false,
			error: {
				type: "UnsafeProjectPaths",
				message: "la raíz «/» es la raíz del sistema",
			},
		});
		assert.deepEqual(spawner.calls, []);
		const again = await launch("1");
		assert.equal(!again.ok && again.error.type, "UnsafeProjectPaths");
	});

	it("un proyecto que ya no está en el registro tampoco abre terminal", async () => {
		const { launch, spawner, failPrepare } = setup();
		failPrepare({ type: "ProjectNotAvailable", message: "no está" });
		const r = await launch("1");
		assert.equal(!r.ok && r.error.type, "ProjectNotAvailable");
		assert.deepEqual(spawner.calls, []);
	});

	it("cada lanzamiento barre antes las carpetas huérfanas (vigilante muerto) y deja las vivas", async () => {
		const { launch, launches, alive, publish } = setup();
		await launch("1");
		publish("s1");
		alive.add(2);
		launches.setPid("/tmp/figma-agent-launch-1", 2);
		launches.create("/tmp/figma-agent-huerfana", {
			settings: {},
			mcpConfig: {},
			launch: {
				projectId: "1",
				args: [],
				cwd: "/",
				env: {},
				guard: { repoRoot: "/", roots: ["/"], denied: [] },
				pid: 99,
			},
		});
		await launch("1");
		assert.deepEqual(launches.removed, ["/tmp/figma-agent-huerfana"]);
		assert.ok(launches.dirs.has("/tmp/figma-agent-launch-1"));
	});

	it("rechaza un segundo lanzamiento mientras el anterior no ha publicado su token", async () => {
		const { launch, spawner } = setup();
		await launch("1");
		const second = await launch("1");
		assert.equal(!second.ok && second.error.type, "LaunchInProgress");
		assert.equal(spawner.calls.length, 1);
	});

	it("dos peticiones simultáneas lanzan una sola terminal", async () => {
		const { launch, spawner } = setup();
		let release = () => {};
		spawner.gate = new Promise<void>((r) => {
			release = r;
		});
		const first = launch("1");
		const second = await launch("1");
		assert.equal(!second.ok && second.error.type, "LaunchInProgress");
		release();
		assert.equal((await first).ok, true);
		assert.equal(spawner.calls.length, 1);
	});

	it("permite otro lanzamiento en cuanto aparece una sesión nueva con chat", async () => {
		const { launch, spawner, publish } = setup();
		publish("vieja");
		await launch("1");
		publish("nueva");
		assert.equal((await launch("1")).ok, true);
		assert.equal(spawner.calls.length, 2);
	});

	it("una sesión que ya existía al lanzar no libera el lanzamiento", async () => {
		const { launch, publish } = setup();
		publish("vieja");
		await launch("1");
		const again = await launch("1");
		assert.equal(!again.ok && again.error.type, "LaunchInProgress");
	});

	it("permite otro lanzamiento al pasar el plazo sin que aparezca ninguna sesión", async () => {
		const { launch, advance, spawner } = setup();
		await launch("1");
		advance(TIMEOUT_MS - 1);
		assert.equal((await launch("1")).ok, false);
		advance(1);
		assert.equal((await launch("1")).ok, true);
		assert.equal(spawner.calls.length, 2);
	});

	it("si la terminal no existe lo dice, borra la carpeta y no bloquea el reintento", async () => {
		const { launch, spawner, launches } = setup(["no-existe", "--"]);
		spawner.fail({ type: "NotFound", message: "ENOENT" });
		const failed = await launch("1");
		assert.ok(!failed.ok);
		assert.equal(failed.error.type, "TerminalNotFound");
		assert.match(failed.error.message, /no-existe/);
		assert.match(failed.error.message, /FCC_AGENT_TERMINAL/);
		assert.deepEqual(launches.removed, ["/tmp/figma-agent-launch-1"]);
		spawner.next = null;
		assert.equal((await launch("1")).ok, true);
	});

	it("cualquier otro fallo al lanzar se informa, borra la carpeta y tampoco bloquea", async () => {
		const { launch, spawner, launches } = setup();
		spawner.fail({ type: "Failed", message: "EACCES" });
		const failed = await launch("1");
		assert.equal(!failed.ok && failed.error.type, "LaunchFailed");
		assert.equal(launches.dirs.size, 0);
		spawner.next = null;
		assert.equal((await launch("1")).ok, true);
	});
});
