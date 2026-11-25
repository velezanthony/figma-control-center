// El guardián PreToolUse como lo ejecuta Claude Code: un proceso real con el JSON de la llamada por stdin. Sale 0 si
// deja pasar y 2 (con el motivo en stderr) si no; ante cualquier fallo propio, 2.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const GUARD = join(import.meta.dirname, "agent-guard.ts");
const SERVER = "mcp__figma-control-center__";

let base: string;
let launchDir: string;
let code: string;
let scripts: string;
let output: string;
let outside: string;
let repo: string;

before(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "figma-guard-")));
	code = join(base, "proyecto");
	scripts = join(code, "scripts");
	output = join(base, "salida");
	outside = join(base, "fuera");
	repo = join(base, "repo");
	launchDir = join(base, "figma-agent-L1");
	for (const d of [code, scripts, output, outside, repo, launchDir])
		mkdirSync(d, { recursive: true });
	mkdirSync(join(output, "chat-tokens"));
	writeFileSync(join(code, "README.md"), "hola");
	writeFileSync(join(code, ".env"), "NADA=1");
	writeFileSync(join(scripts, "ok.js"), "return 1");
	writeFileSync(join(outside, "marca.txt"), "fuera");
	writeFileSync(join(repo, "script.js"), "return 1");
	writeFileSync(join(output, "chat-tokens", "s.token"), "x");
	symlinkSync(join(outside, "marca.txt"), join(code, "enlace.txt"));
	symlinkSync(join(code, ".env"), join(code, "inocente.txt"));
	writeLaunch({
		projectId: "1",
		args: [],
		cwd: code,
		env: {},
		pid: process.pid,
		guard: {
			repoRoot: repo,
			roots: [code, scripts, output],
			denied: [join(output, "chat-tokens")],
		},
	});
});
after(() => rmSync(base, { recursive: true, force: true }));

function writeLaunch(content: unknown, dir = launchDir): void {
	writeFileSync(join(dir, "launch.json"), JSON.stringify(content));
}

const run = (stdin: string, dir: string = launchDir) =>
	spawnSync(process.execPath, [GUARD, dir], {
		input: stdin,
		encoding: "utf8",
		env: { PATH: process.env["PATH"] ?? "" },
	});

const call = (tool: string, input: Record<string, unknown>, dir?: string) =>
	run(
		JSON.stringify({
			session_id: "s",
			hook_event_name: "PreToolUse",
			cwd: code,
			tool_name: tool,
			tool_input: input,
		}),
		dir,
	);

const allowed = (r: ReturnType<typeof run>) => {
	assert.equal(r.status, 0, r.stderr);
};
const denied = (r: ReturnType<typeof run>, reason: RegExp) => {
	assert.equal(r.status, 2, `debería denegar; stderr: ${r.stderr}`);
	assert.match(r.stderr, reason);
};

describe("agent-guard: rutas dentro y fuera", () => {
	it("leer o buscar dentro de las raíces del proyecto pasa", () => {
		allowed(call("Read", { file_path: join(code, "README.md") }));
		allowed(call("Read", { file_path: join(output, "resultado.json") }));
		allowed(call("Glob", { pattern: "**/*.js" }));
		allowed(call("Grep", { pattern: "x", path: scripts }));
	});

	it("una ruta fuera de las raíces se deniega con el motivo", () => {
		denied(
			call("Read", { file_path: join(outside, "marca.txt") }),
			/fuera de las raíces/,
		);
		denied(
			call("Grep", { pattern: "x", path: outside }),
			/fuera de las raíces/,
		);
		denied(call("Glob", { pattern: `${outside}/**` }), /fuera de las raíces/);
	});

	it("un «..» que sale de las raíces se deniega", () => {
		denied(
			call("Read", { file_path: join(code, "..", "fuera", "marca.txt") }),
			/fuera de las raíces/,
		);
	});

	it("un enlace simbólico que sale de las raíces se deniega", () => {
		denied(
			call("Read", { file_path: join(code, "enlace.txt") }),
			/fuera de las raíces/,
		);
	});

	it("un secreto se deniega aunque esté dentro, también tras un enlace con nombre inocente", () => {
		denied(call("Read", { file_path: join(code, ".env") }), /secreto/);
		denied(call("Read", { file_path: join(code, "inocente.txt") }), /secreto/);
		denied(call("Read", { file_path: join(code, "clave.pem") }), /secreto/);
		denied(call("Read", { file_path: join(scripts, ".env.local") }), /secreto/);
	});

	it("los tokens del chat se deniegan aunque cuelguen de la carpeta de salida", () => {
		denied(
			call("Read", { file_path: join(output, "chat-tokens", "s.token") }),
			/protegida/,
		);
		denied(
			call("Glob", { pattern: "*", path: join(output, "chat-tokens") }),
			/protegida/,
		);
	});
});

describe("agent-guard: el agente del chat solo consulta", () => {
	it("escribir ficheros se deniega aunque la ruta esté dentro de las raíces", () => {
		denied(
			call("Write", { file_path: join(scripts, "nuevo.js"), content: "" }),
			/solo consulta/,
		);
		denied(
			call("Edit", { file_path: join(output, "x.json") }),
			/solo consulta/,
		);
		denied(
			call("NotebookEdit", { notebook_path: join(code, "x.ipynb") }),
			/solo consulta/,
		);
	});

	it("las herramientas que cambian Figma o capturan la web se deniegan aunque el script esté en una raíz", () => {
		denied(
			call(`${SERVER}figma_run_script`, { file: join(scripts, "ok.js") }),
			/solo consulta/,
		);
		denied(
			call(`${SERVER}figma_build`, {
				steps: [{ file: join(scripts, "ok.js") }],
			}),
			/solo consulta/,
		);
		denied(call(`${SERVER}figma_cancel_job`, { jobId: "j" }), /solo consulta/);
		denied(
			call(`${SERVER}figma_capture`, { screens: ["home"] }),
			/solo consulta/,
		);
	});

	it("una herramienta de consulta sin rutas (figma_status, figma_chat_reply) pasa", () => {
		allowed(call(`${SERVER}figma_status`, {}));
		allowed(call(`${SERVER}figma_chat_reply`, { chat_id: "1", text: "hola" }));
	});
});

describe("agent-guard: falla cerrado", () => {
	it("un JSON roto en stdin se deniega", () => {
		denied(run("{no es json"), /falla cerrado/);
	});

	it("una llamada sin forma de llamada (sin tool_input) se deniega", () => {
		denied(run(JSON.stringify({ tool_name: "Read" })), /falla cerrado/);
	});

	it("sin launch.json en la carpeta, o ilegible, se deniega", () => {
		const empty = join(base, "figma-agent-vacio");
		mkdirSync(empty);
		denied(
			call("Read", { file_path: join(code, "README.md") }, empty),
			/falla cerrado/,
		);
		writeFileSync(join(empty, "launch.json"), "{roto");
		denied(
			call("Read", { file_path: join(code, "README.md") }, empty),
			/falla cerrado/,
		);
		writeLaunch({ guard: { roots: "no es una lista" } }, empty);
		denied(
			call("Read", { file_path: join(code, "README.md") }, empty),
			/falla cerrado/,
		);
	});

	it("sin carpeta del lanzamiento en los argumentos se deniega", () => {
		const r = spawnSync(process.execPath, [GUARD], {
			input: "{}",
			encoding: "utf8",
		});
		denied(r, /falla cerrado/);
	});

	it("una herramienta que el guardián no conoce se deniega", () => {
		denied(call(`${SERVER}figma_nueva`, {}), /no conoce/);
	});
});
