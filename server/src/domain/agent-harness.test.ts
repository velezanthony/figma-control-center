import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	agentEnvironment,
	agentHarness,
	type HarnessMachine,
	type HarnessProject,
} from "./agent-harness.ts";

const EXPECTED = JSON.parse(
	readFileSync(
		join(
			import.meta.dirname,
			"../../test/fixtures/agent-harness/project-a.json",
		),
		"utf8",
	),
) as unknown;

const REPO = "/opt/figma-control-center";
const MACHINE: HarnessMachine = {
	repoRoot: REPO,
	home: "/home/dueno",
	nodeBin: "/usr/bin/node",
	launchDir: "/tmp/figma-agent-L1",
	outputRoot: `${REPO}/output`,
	dbPath: `${REPO}/output/figma.db`,
	secretsFile: "/home/dueno/.config/figma-control-center/secrets.json",
	defaultScriptsRoots: [`${REPO}/scripts`],
	otherProjects: [
		{
			id: "2",
			roots: ["/srv/proyecto-b", "/srv/proyecto-b/scripts", "/srv/salida-b"],
		},
	],
};

const real = (path: string) => ({ given: path, real: path });

const PROJECT: HarnessProject = {
	id: "1",
	projectDir: real("/srv/proyecto-a"),
	scriptsRoots: [real("/srv/proyecto-a/scripts-figma")],
	outputDir: real("/srv/salida-a"),
};

// Lo que se lanza, con lo que cambia en cada test
const harness = (
	over: Partial<HarnessProject> = {},
	machine: Partial<HarnessMachine> = {},
) => agentHarness({ ...PROJECT, ...over }, { ...MACHINE, ...machine });

const problemOf = (r: ReturnType<typeof harness>): string => {
	assert.equal(r.ok, false, "debería negarse a lanzar");
	if (r.ok) return "";
	assert.equal(r.error.type, "UnsafeProjectPaths");
	return r.error.message;
};

describe("agentHarness: la configuración de un lanzamiento", () => {
	it("para un proyecto con raíces propias da exactamente settings, mcp.json, la orden, el cwd, el entorno y las raíces del guardián", () => {
		const r = harness();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.deepEqual(
			{
				settings: r.value.settings,
				mcpConfig: r.value.mcpConfig,
				args: r.value.args,
				cwd: r.value.cwd,
				env: r.value.env,
				guard: r.value.guard,
			},
			EXPECTED,
		);
	});

	it("una raíz de scripts por cada --add-dir (para leerla), en orden, y después la carpeta de salida", () => {
		const r = harness({
			scriptsRoots: [real("/srv/a/uno"), real("/srv/a/dos")],
		});
		assert.ok(r.ok);
		const dirs = r.value.args.flatMap((a, i, all) =>
			all[i - 1] === "--add-dir" ? [a] : [],
		);
		assert.deepEqual(dirs, ["/srv/a/uno", "/srv/a/dos", "/srv/salida-a"]);
	});
});

describe("agentHarness: rutas que impiden lanzar", () => {
	it("una raíz que no existe se nombra y dice por qué", () => {
		const message = problemOf(
			harness({ outputDir: { given: "/srv/no-esta", real: null } }),
		);
		assert.match(message, /«\/srv\/no-esta»/);
		assert.match(message, /no existe/);
	});

	it("la raíz del sistema no vale como raíz", () => {
		assert.match(
			problemOf(harness({ projectDir: real("/") })),
			/«\/».*raíz del sistema/,
		);
	});

	it("la carpeta personal, o una que la contiene, no valen", () => {
		assert.match(
			problemOf(harness({ projectDir: real("/home/dueno") })),
			/«\/home\/dueno».*carpeta personal/,
		);
		assert.match(
			problemOf(harness({ projectDir: real("/home") })),
			/«\/home».*contiene tu carpeta personal/,
		);
	});

	it("el repo de la herramienta, o una carpeta que lo contiene, no valen", () => {
		assert.match(
			problemOf(harness({ projectDir: real(REPO) })),
			/«\/opt\/figma-control-center».*repo de la herramienta/,
		);
		assert.match(
			problemOf(harness({ projectDir: real("/opt") })),
			/«\/opt».*contiene el repo de la herramienta/,
		);
	});

	it("una carpeta dentro del repo de la herramienta no vale", () => {
		assert.match(
			problemOf(harness({ outputDir: real(`${REPO}/output/1`) })),
			/«\/opt\/figma-control-center\/output\/1».*dentro del repo de la herramienta/,
		);
	});

	it("la raíz de scripts por defecto de la máquina se niega y dice cómo darle una propia (D-5)", () => {
		const message = problemOf(
			harness({ scriptsRoots: [real(`${REPO}/scripts`)] }),
		);
		assert.match(message, /por defecto de la máquina/);
		assert.match(message, /«Proyectos»/);
	});

	it("una raíz que coincide o se solapa con una de otro proyecto no vale, y nombra el otro proyecto", () => {
		for (const projectDir of [
			"/srv/proyecto-b",
			"/srv/proyecto-b/dentro",
			"/srv",
		]) {
			const message = problemOf(harness({ projectDir: real(projectDir) }));
			assert.match(message, /proyecto 2/, projectDir);
		}
	});

	it("una carpeta de salida que contiene los tokens del chat de la máquina o la base no vale", () => {
		assert.match(
			problemOf(
				harness({ outputDir: real("/srv/out") }, { outputRoot: "/srv/out" }),
			),
			/«\/srv\/out».*tokens del chat/,
		);
		assert.match(
			problemOf(
				harness(
					{ outputDir: real("/srv/datos") },
					{ dbPath: "/srv/datos/figma.db" },
				),
			),
			/«\/srv\/datos».*base de la máquina/,
		);
	});

	it("la carpeta del lanzamiento no puede caer dentro de una raíz del proyecto", () => {
		assert.match(
			problemOf(harness({}, { launchDir: "/srv/salida-a/figma-agent-L1" })),
			/carpeta del lanzamiento/,
		);
	});

	it("se comprueba la ruta ya resuelta (realpath), no la escrita: un enlace o un «..» que acaban en el repo se niegan", () => {
		const message = problemOf(
			harness({
				projectDir: { given: "/srv/enlace-al-repo/..", real: REPO },
			}),
		);
		assert.match(
			message,
			/«\/srv\/enlace-al-repo\/\.\.».*repo de la herramienta/,
		);
	});

	it("todos los problemas salen juntos, no solo el primero", () => {
		const message = problemOf(
			harness({
				projectDir: real("/"),
				outputDir: { given: "/srv/no-esta", real: null },
			}),
		);
		assert.match(message, /raíz del sistema/);
		assert.match(message, /no existe/);
	});
});

describe("agentEnvironment: el entorno limpio de claude", () => {
	it("solo pasa la lista blanca (con LC_*) y añade la marca de agente y el proyecto; nada del .env", () => {
		const env = agentEnvironment(
			{
				PATH: "/usr/bin",
				HOME: "/home/dueno",
				USER: "dueno",
				LANG: "es_ES.UTF-8",
				LC_TIME: "es_ES.UTF-8",
				TERM: "xterm-256color",
				COLORTERM: "truecolor",
				DISPLAY: ":0",
				WAYLAND_DISPLAY: "wayland-0",
				XDG_RUNTIME_DIR: "/run/user/1000",
				DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
				FCC_DB: "/opt/figma-control-center/output/figma.db",
				FCC_PROJECTS: "any",
				ANTHROPIC_API_KEY: "secreto",
				SSH_AUTH_SOCK: "/run/ssh",
				NADA: undefined,
			},
			{ FCC_CHAT_AGENT: "1", FCC_PROJECTS: "1" },
		);
		assert.deepEqual(env, {
			PATH: "/usr/bin",
			HOME: "/home/dueno",
			USER: "dueno",
			LANG: "es_ES.UTF-8",
			LC_TIME: "es_ES.UTF-8",
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
			DISPLAY: ":0",
			WAYLAND_DISPLAY: "wayland-0",
			XDG_RUNTIME_DIR: "/run/user/1000",
			DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
			FCC_CHAT_AGENT: "1",
			FCC_PROJECTS: "1",
		});
	});
});

describe("agentHarness: el agente del chat solo consulta", () => {
	const permissionsOf = () => {
		const r = harness();
		assert.ok(r.ok);
		return {
			args: r.value.args,
			permissions: r.value.settings["permissions"] as Record<string, unknown>,
		};
	};

	it("las seis lecturas del catálogo van sin preguntar", () => {
		const { permissions } = permissionsOf();
		const allow = permissions["allow"] as string[];
		for (const tool of [
			"figma_variables",
			"figma_styles",
			"figma_components",
			"figma_instances",
			"figma_export",
			"figma_design_context",
		]) {
			assert.ok(allow.includes(`mcp__figma-control-center__${tool}`), tool);
		}
	});

	it("no tiene herramientas de escritura de ficheros ni reglas que permitan escribir", () => {
		const { args, permissions } = permissionsOf();
		assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
		const allow = permissions["allow"] as string[];
		assert.deepEqual(
			allow.filter((rule) => /^(Write|Edit|NotebookEdit)\b/.test(rule)),
			[],
		);
		const deny = permissions["deny"] as string[];
		for (const tool of ["Write", "Edit", "NotebookEdit"])
			assert.ok(deny.includes(tool), tool);
	});

	it("las herramientas que cambian Figma o capturan la web se deniegan, no se preguntan", () => {
		const { permissions } = permissionsOf();
		assert.equal(permissions["ask"], undefined);
		const deny = permissions["deny"] as string[];
		for (const tool of [
			"figma_run_script",
			"figma_build",
			"figma_cancel_job",
			"figma_capture",
		]) {
			assert.ok(deny.includes(`mcp__figma-control-center__${tool}`), tool);
		}
	});
});
