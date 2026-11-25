// E40-E43: el panel lanza el agente con el arnés. La cadena es la de producción (make →
// agent-run.ts → claude → servidor MCP) con el lanzador simulado y el `claude` FALSO: nunca un Claude Code real.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "#adapters/config/schema.ts";
import { agentProjectDirs } from "../../harness/env.ts";
import {
	type Environment,
	startEnvironment,
	TERMINAL_ARGV_FILE,
} from "../../harness/environment.ts";
import { until } from "../../harness/wait.ts";

const OTHER_FILE_URL = "https://www.figma.com/design/OTRO123/Otro";

const post = (env: Environment, path: string, body?: unknown) =>
	fetch(`${env.dashboardUrl}${path}`, {
		method: "POST",
		headers: { Origin: env.dashboardUrl, "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
const launch = (env: Environment, project?: string) =>
	post(
		env,
		`/api/agent/launch${project === undefined ? "" : `?project=${project}`}`,
	);
const addProject = async (
	env: Environment,
	entry: Record<string, unknown>,
): Promise<string> => {
	const r = await post(env, "/api/projects/save", {
		entry,
		confirmScriptsRoots: true,
	});
	assert.equal(r.status, 200, await r.clone().text());
	const list = await env.api<{ entries: { id: string; name: string }[] }>(
		"/api/projects/list",
	);
	const found = list.entries.find((e) => e.name === entry["name"]);
	assert.ok(found);
	return found.id;
};
const errorOf = async (r: Response) =>
	((await r.json()) as { error: { type: string; message: string } }).error;
const launchDirs = (env: Environment) =>
	readdirSync(join(env.dir, "tmp")).filter((n) => n.startsWith("figma-agent-"));

// Un pid que ya no existe: el de un proceso que acaba de terminar
const deadPid = (): number => {
	const r = spawnSync(process.execPath, ["-e", ""]);
	assert.ok(r.pid !== undefined);
	return r.pid;
};
const writeLaunchDir = (tmp: string, name: string, pid: number): string => {
	const dir = join(tmp, `figma-agent-${name}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "launch.json"),
		JSON.stringify({
			projectId: "1",
			args: [],
			cwd: "/",
			env: {},
			guard: { repoRoot: "/", roots: ["/srv"], denied: [] },
			pid,
		}),
	);
	return dir;
};

describe("E40 · lanzar el agente con el arnés", () => {
	it("la carpeta lleva la config del proyecto, la sesión aparece con chat, su MCP solo ve ese proyecto y al salir claude la carpeta desaparece", async () => {
		const env = await startEnvironment({ agentProject: true });
		try {
			await addProject(env, {
				name: "Otro",
				projectDir: join(env.dir, "proyecto-b"),
				fileUrl: OTHER_FILE_URL,
				scriptsRoots: [join(env.dir, "proyecto-b", "scripts")],
				outputDir: join(env.dir, "salida-b"),
			});
			assert.equal((await launch(env, "1")).status, 202);
			await until(
				"claude (el falso) arranca",
				() => env.fakeClaude.record() !== null,
			);
			const seen = env.fakeClaude.record();
			assert.ok(seen);
			const d = agentProjectDirs(env.dir);
			const dir = dirname(seen.argv[2] as string);
			assert.equal(dirname(dir), join(env.dir, "tmp"));
			assert.equal(seen.cwd, realpathSync(d.projectDir));
			assert.deepEqual(seen.argv, [
				"--restricted",
				"--settings",
				join(dir, "settings.json"),
				"--mcp-config",
				join(dir, "mcp.json"),
				"--strict-mcp-config",
				"--tools",
				"Read,Glob,Grep",
				"--permission-mode",
				"default",
				"--add-dir",
				realpathSync(d.scriptsRoot),
				"--add-dir",
				realpathSync(d.outputDir),
				"--disable-slash-commands",
				"--no-chrome",
				"--dangerously-load-development-channels",
				"server:figma-control-center",
			]);
			assert.deepEqual(seen.files["mcp.json"], {
				mcpServers: {
					"figma-control-center": {
						type: "stdio",
						command: process.execPath,
						args: [join(REPO_ROOT, "server/src/main.ts")],
						env: { FCC_PROJECTS: "1", FCC_CHAT_AGENT: "1" },
					},
				},
			});
			const settings = seen.files["settings.json"] as {
				permissions: { deny: string[]; defaultMode: string };
			};
			assert.equal(settings.permissions.defaultMode, "default");
			assert.ok(settings.permissions.deny.includes("Bash"));
			assert.equal(seen.env["FCC_PROJECTS"], "1");
			assert.equal(seen.env["FCC_DB"], undefined);

			await until("la sesión lanzada publica su chat", async () => {
				const s = await env.api<{ items: { alive: boolean }[] }>(
					"/api/chat/sessions?project=1",
				);
				return s.items.some((i) => i.alive);
			});
			await until(
				"su MCP respondió a figma_status",
				() => env.fakeClaude.status() !== null,
			);
			const status = JSON.stringify(env.fakeClaude.status());
			assert.doesNotMatch(status, /OTRO123|Otro|elige uno/);

			process.kill(seen.pid, "SIGTERM");
			await until(
				"al salir claude, la carpeta ya no está",
				() => !existsSync(dir),
			);
		} finally {
			await env.stop();
		}
	});
});

describe("E41 · lo que no se lanza", () => {
	it("sin proyecto, con una raíz que es el repo, que se solapa con otro proyecto o que no existe: error, ni terminal ni carpeta", async () => {
		const env = await startEnvironment({ agentProject: true });
		try {
			mkdirSync(join(agentProjectDirs(env.dir).projectDir, "sub"));
			const none = await launch(env);
			assert.equal(none.status, 400);
			assert.equal((await errorOf(none)).type, "ProjectRequired");

			const cases: [Record<string, unknown>, RegExp][] = [
				[{ name: "Repo", projectDir: REPO_ROOT }, /repo de la herramienta/],
				[
					{
						name: "Solapado",
						projectDir: join(agentProjectDirs(env.dir).projectDir, "sub"),
					},
					/se solapa/,
				],
				[
					{ name: "Fantasma", projectDir: join(env.dir, "no-existe") },
					/no existe/,
				],
			];
			let n = 0;
			for (const [entry, reason] of cases) {
				n++;
				const id = await addProject(env, {
					...entry,
					fileUrl: `https://www.figma.com/design/CASO${n}/Caso`,
					scriptsRoots: [join(env.dir, `scripts-${n}`)],
					outputDir: join(env.dir, `salida-${n}`),
				});
				mkdirSync(join(env.dir, `scripts-${n}`), { recursive: true });
				mkdirSync(join(env.dir, `salida-${n}`), { recursive: true });
				const r = await launch(env, id);
				assert.equal(r.status, 409, String(entry["name"]));
				const e = await errorOf(r);
				assert.equal(e.type, "UnsafeProjectPaths");
				assert.match(e.message, reason);
				assert.match(e.message, /«Proyectos»/);
			}
			assert.equal(existsSync(join(env.dir, TERMINAL_ARGV_FILE)), false);
			assert.deepEqual(launchDirs(env), []);
		} finally {
			await env.stop();
		}
	});
});

describe("E43 · barrido de carpetas huérfanas", () => {
	it("al arrancar el panel y en cada lanzamiento desaparecen las carpetas de un vigilante muerto; las de uno vivo se quedan", async () => {
		let deadAtBoot = "";
		let alive = "";
		const env = await startEnvironment({
			agentProject: true,
			launcher: "does-nothing",
			prepareDir: (dir) => {
				const tmp = join(dir, "tmp");
				deadAtBoot = writeLaunchDir(tmp, "muerta-al-arrancar", deadPid());
				alive = writeLaunchDir(tmp, "viva", process.pid);
			},
		});
		try {
			assert.equal(existsSync(deadAtBoot), false);
			assert.equal(existsSync(alive), true);
			const deadAtLaunch = writeLaunchDir(
				join(env.dir, "tmp"),
				"muerta",
				deadPid(),
			);
			assert.equal((await launch(env, "1")).status, 202);
			assert.equal(existsSync(deadAtLaunch), false);
			assert.equal(existsSync(alive), true);
		} finally {
			await env.stop();
		}
	});
});
