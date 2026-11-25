import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { LaunchFiles } from "#application/ports/agent-launches.ts";
import { FsAgentLaunches, readLaunchFile } from "./fs-agent-launch.ts";

const MODE_BITS = 0o777;
const OLD_S = 3600;

let parent: string;
beforeEach(() => {
	parent = mkdtempSync(join(tmpdir(), "figma-launches-"));
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

const files = (pid: number): LaunchFiles => ({
	settings: { permissions: {} },
	mcpConfig: { mcpServers: {} },
	launch: {
		projectId: "1",
		args: ["--restricted"],
		cwd: "/srv/a",
		env: { FCC_PROJECTS: "1" },
		guard: { repoRoot: "/repo", roots: ["/srv/a"], denied: [] },
		pid,
	},
});

const mode = (path: string) => statSync(path).mode & MODE_BITS;

describe("FsAgentLaunches", () => {
	it("la carpeta va en la carpeta temporal dada, con el prefijo figma-agent-", () => {
		const launches = new FsAgentLaunches({ parent });
		assert.equal(launches.pathFor("L1"), join(parent, "figma-agent-L1"));
	});

	it("crea la carpeta 0700 con settings.json, mcp.json y launch.json 0600, y launch.json se lee de vuelta", () => {
		const launches = new FsAgentLaunches({ parent });
		const dir = launches.pathFor("L1");
		launches.create(dir, files(123));
		assert.equal(mode(dir), 0o700);
		for (const name of ["settings.json", "mcp.json", "launch.json"]) {
			assert.equal(mode(join(dir, name)), 0o600, name);
		}
		assert.deepEqual(
			JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")),
			{ permissions: {} },
		);
		assert.deepEqual(readLaunchFile(dir), {
			ok: true,
			value: files(123).launch,
		});
	});

	it("no reutiliza una carpeta que ya existe", () => {
		const launches = new FsAgentLaunches({ parent });
		const dir = launches.pathFor("L1");
		launches.create(dir, files(1));
		assert.throws(() => launches.create(dir, files(1)));
	});

	it("find lee el launch.json de un lanzamiento, y null si no hay carpeta o no se puede leer", () => {
		const launches = new FsAgentLaunches({ parent });
		launches.create(launches.pathFor("L1"), files(123));
		assert.equal(launches.find("L1")?.pid, 123);
		assert.equal(launches.find("L2"), null);
		mkdirSync(launches.pathFor("L3"));
		writeFileSync(join(launches.pathFor("L3"), "launch.json"), "{roto");
		assert.equal(launches.find("L3"), null);
	});

	it("setPid cambia quién vigila la carpeta", () => {
		const launches = new FsAgentLaunches({ parent });
		const dir = launches.pathFor("L1");
		launches.create(dir, files(1));
		launches.setPid(dir, 77);
		const read = readLaunchFile(dir);
		assert.equal(read.ok && read.value.pid, 77);
		assert.equal(mode(join(dir, "launch.json")), 0o600);
	});

	it("el barrido borra las carpetas de un vigilante muerto y deja las de uno vivo y lo que no es suyo", () => {
		const launches = new FsAgentLaunches({ parent });
		const dead = launches.pathFor("muerto");
		const alive = launches.pathFor("vivo");
		launches.create(dead, files(10));
		launches.create(alive, files(20));
		mkdirSync(join(parent, "otra-cosa"));
		const removed = launches.sweep((pid) => pid === 20);
		assert.deepEqual(removed, [dead]);
		assert.equal(existsSync(dead), false);
		assert.equal(existsSync(alive), true);
		assert.equal(existsSync(join(parent, "otra-cosa")), true);
	});

	it("una carpeta sin launch.json legible se barre solo si es vieja (otra puede estar creándose)", () => {
		const launches = new FsAgentLaunches({ parent });
		const fresh = launches.pathFor("recien");
		const old = launches.pathFor("vieja");
		mkdirSync(fresh);
		mkdirSync(old);
		writeFileSync(join(old, "launch.json"), "{roto");
		const past = Date.now() / 1000 - OLD_S;
		utimesSync(old, past, past);
		assert.deepEqual(
			launches.sweep(() => true),
			[old],
		);
		assert.equal(existsSync(fresh), true);
	});

	it("remove borra la carpeta, y si ya no estaba no falla", () => {
		const launches = new FsAgentLaunches({ parent });
		const dir = launches.pathFor("L1");
		launches.create(dir, files(1));
		launches.remove(dir);
		assert.equal(existsSync(dir), false);
		launches.remove(dir);
	});
});
