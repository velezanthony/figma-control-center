import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenantConfig } from "#domain/config.ts";
import type { RegistryEntry } from "#domain/registry.ts";
import { makePrepareAgentLaunch } from "./prepare-agent-launch.ts";
import { InMemoryAgentLaunches } from "./testing/in-memory-agent-launches.ts";
import { InMemoryProjectRegistry } from "./testing/in-memory-project-registry.ts";

const REPO = "/repo";
const A: RegistryEntry = {
	id: "1",
	name: "A",
	projectDir: "/srv/a",
	fileUrl: "https://www.figma.com/design/AAA/A",
	scriptsRoots: ["/srv/a/scripts"],
	outputDir: "/srv/salida-a",
};
const B: RegistryEntry = {
	id: "2",
	name: "B",
	projectDir: "/srv/b",
	fileUrl: "https://www.figma.com/design/BBB/B",
};

const resolveEntry = (e: RegistryEntry): TenantConfig => ({
	id: e.id,
	name: e.name,
	fileUrl: e.fileUrl,
	scriptsRoots: e.scriptsRoots ?? [`${REPO}/scripts`],
	outputDir: e.outputDir ?? `${REPO}/output/${e.id}`,
	projectDir: "/proyecto",
	activityFile: "",
});

function setup(entries: RegistryEntry[] = [A, B], missing: string[] = []) {
	const launches = new InMemoryAgentLaunches();
	const prepare = makePrepareAgentLaunch({
		registry: new InMemoryProjectRegistry({ entries }),
		resolveEntry,
		realpath: async (p) => (missing.includes(p) ? null : p),
		launches,
		machine: {
			repoRoot: REPO,
			home: "/home/dueno",
			nodeBin: "/usr/bin/node",
			outputRoot: `${REPO}/output`,
			dbPath: `${REPO}/output/figma.db`,
			secretsFile: "/home/dueno/.config/figma-control-center/secrets.json",
			defaultScriptsRoots: [`${REPO}/scripts`],
		},
		pid: 4242,
	});
	return { prepare, launches };
}

describe("makePrepareAgentLaunch", () => {
	it("crea la carpeta del lanzamiento con settings, mcp.json y launch.json (con el pid de quien la vigila)", async () => {
		const { prepare, launches } = setup();
		const r = await prepare("1", "L1");
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.dir, "/tmp/figma-agent-L1");
		const files = launches.dirs.get("/tmp/figma-agent-L1");
		assert.ok(files);
		assert.equal(files.launch.projectId, "1");
		assert.equal(files.launch.pid, 4242);
		assert.equal(files.launch.cwd, "/srv/a");
		assert.deepEqual(files.launch.guard.roots, [
			"/srv/a",
			"/srv/a/scripts",
			"/srv/salida-a",
		]);
		assert.ok(files.launch.args.includes("/tmp/figma-agent-L1/settings.json"));
		assert.deepEqual(files.mcpConfig, r.value.files.mcpConfig);
	});

	it("un proyecto que no está en el registro no crea nada", async () => {
		const { prepare, launches } = setup();
		const r = await prepare("9", "L1");
		assert.equal(!r.ok && r.error.type, "ProjectNotAvailable");
		assert.equal(launches.dirs.size, 0);
	});

	it("un proyecto con raíces peligrosas no crea carpeta y dice cuál y por qué", async () => {
		const { prepare, launches } = setup([A, { ...B, id: "3" }]);
		const r = await prepare("3", "L1");
		assert.ok(!r.ok);
		assert.equal(r.error.type, "UnsafeProjectPaths");
		// B no tiene raíz de scripts propia: cae a la de la máquina (D-5)
		assert.match(
			r.error.message,
			/«\/repo\/scripts».*por defecto de la máquina/,
		);
		assert.equal(launches.dirs.size, 0);
	});

	it("una raíz que no existe se nombra", async () => {
		const { prepare } = setup([A, B], ["/srv/salida-a"]);
		const r = await prepare("1", "L1");
		assert.ok(!r.ok);
		assert.match(r.error.message, /«\/srv\/salida-a» no existe/);
	});

	it("las raíces de los otros proyectos cuentan para el solape", async () => {
		const { prepare } = setup([A, { ...B, projectDir: "/srv/a/dentro" }]);
		const r = await prepare("1", "L1");
		assert.ok(!r.ok);
		assert.match(r.error.message, /proyecto 2/);
	});

	it("si no se puede escribir la carpeta, lo dice y no deja nada", async () => {
		const { prepare, launches } = setup();
		launches.createFails = new Error("EACCES");
		const r = await prepare("1", "L1");
		assert.equal(!r.ok && r.error.type, "LaunchFailed");
		assert.match(!r.ok ? r.error.message : "", /EACCES/);
		assert.deepEqual(launches.removed, ["/tmp/figma-agent-L1"]);
	});
});
