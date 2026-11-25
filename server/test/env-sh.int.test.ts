// Los scripts de shell funcionan sin .env y lo leen sin ejecutarlo (spikes/m0/env.sh).
// Todo ocurre en el arnés de scripts (harness/script-sandbox.ts): repo y HOME temporales con .env falsos y
// `google-chrome`, `pkill` y `pgrep` falsos delante del PATH; no se lanza Chrome ni se lee el .env real.
import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { REPO_ROOT } from "#adapters/config/schema.ts";
import {
	createScriptSandbox,
	liveProcessesMentioning,
	type ScriptSandbox,
	serveDebugPort,
} from "./harness/script-sandbox.ts";

let sb: ScriptSandbox;
beforeEach(async () => {
	sb = await createScriptSandbox();
});
afterEach(() => {
	const paths = [sb.root, sb.home];
	sb.cleanup();
	assert.deepEqual(liveProcessesMentioning(...paths), []);
	for (const p of paths) assert.equal(existsSync(p), false);
});

const writeEnv = (text: string) => sb.writeEnv(text);
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
	sb.run(cmd, args, { env });
const get = (name: string, def = "DEF", env: Record<string, string> = {}) =>
	run(
		"bash",
		["-c", `source spikes/m0/env.sh; env_get ${name} "${def}"`],
		env,
	).stdout.replace(/\n$/, "");

describe("el arnés de los scripts no puede lanzar ni matar Chrome", () => {
	it("google-chrome, pkill y pgrep que ven los scripts son falsos, de una carpeta temporal", () => {
		const r = run("bash", ["-c", "command -v google-chrome pkill pgrep"]);
		const found = r.stdout.trim().split("\n");
		assert.equal(found.length, 3);
		for (const path of found) {
			assert.ok(path.startsWith(tmpdir()), `${path} no es un falso del arnés`);
		}
	});

	it("chrome.sh SIN modo de prueba solo llama al google-chrome falso, en el puerto libre y con el perfil temporal", () => {
		// El falso se queda contestando en el puerto con los argumentos que recibe, como un Chrome de verdad
		const r = sb.run("bash", ["spikes/m0/chrome.sh"], {
			dryRun: false,
			env: { FAKE_CHROME_MODE: "serve" },
		});
		assert.equal(r.status, 0, r.stderr);
		const calls = sb.calls().filter((c) => c.tool === "google-chrome");
		assert.equal(calls.length, 1);
		const args = calls[0]?.args ?? [];
		assert.ok(args.includes(`--remote-debugging-port=${sb.port}`));
		assert.ok(args.some((a) => a.startsWith(`--user-data-dir=${sb.home}`)));
		assert.notEqual(sb.port, 9222);
	});

	it("login.sh SIN modo de prueba solo llama a los falsos: pkill sobre el puerto libre y una ventana falsa", () => {
		const r = sb.run("bash", ["spikes/m0/login.sh"], { dryRun: false });
		assert.equal(r.status, 0, r.stderr);
		const calls = sb.calls();
		const pkill = calls.find((c) => c.tool === "pkill");
		assert.ok(
			pkill?.args.join(" ").includes(`emote-debugging-port=${sb.port}`),
		);
		assert.ok(!calls.some((c) => c.args.join(" ").includes("9222")));
		assert.equal(calls.filter((c) => c.tool === "google-chrome").length, 1);
	});

	it("ningún otro test ejecuta chrome.sh ni login.sh: solo este, por el arnés", () => {
		const offenders = [
			...globSync("server/**/*.test.ts", { cwd: REPO_ROOT }),
			...globSync("server/**/*.spec.ts", { cwd: REPO_ROOT }),
		].filter(
			(file) =>
				statSync(join(REPO_ROOT, file)).isFile() &&
				!file.endsWith("env-sh.int.test.ts") &&
				/(spawn|exec)\w*\([^;]{0,200}(chrome|login)\.sh|spawn(Sync)?\(\s*["']google-chrome/.test(
					readFileSync(join(REPO_ROOT, file), "utf8"),
				),
		);
		assert.deepEqual(offenders, []);
	});

	it("el arnés se niega a usar el camino real en otro puerto", () => {
		assert.throws(
			() =>
				sb.run("bash", ["spikes/m0/chrome.sh"], {
					dryRun: false,
					env: { FIGMA_CDP_PORT: "9222" },
				}),
			/puerto libre/,
		);
	});
});

describe("env_get", () => {
	it("sin .env devuelve el default", () => {
		assert.equal(get("X"), "DEF");
	});

	it("lee valores con espacios, guiones, & y = sin ejecutar nada", () => {
		writeEnv(
			[
				"# comentario",
				"",
				"A=gnome-terminal --",
				"B=https://x.test/a?b=1&c=2",
				'C="con espacios # y almohadilla"',
				"D='comilla simple'",
				"E=valor # comentario al final",
				"export F=exportada",
				`G=$(touch ${join(sb.root, "pwned")})`,
				`H=\`touch ${join(sb.root, "pwned")}\``,
				"I=",
				"J=primero",
				"J=ultimo",
				"",
			].join("\n"),
		);
		assert.equal(get("A"), "gnome-terminal --");
		assert.equal(get("B"), "https://x.test/a?b=1&c=2");
		assert.equal(get("C"), "con espacios # y almohadilla");
		assert.equal(get("D"), "comilla simple");
		assert.equal(get("E"), "valor");
		assert.equal(get("F"), "exportada");
		assert.equal(get("G"), `$(touch ${join(sb.root, "pwned")})`);
		assert.equal(get("I"), "DEF");
		assert.equal(get("J"), "ultimo");
		assert.equal(get("NOESTA"), "DEF");
		assert.equal(existsSync(join(sb.root, "pwned")), false);
	});

	it("una variable de entorno manda sobre el .env, como en process.loadEnvFile", () => {
		writeEnv("A=del-env\n");
		assert.equal(get("A", "DEF", { A: "del-entorno" }), "del-entorno");
	});
});

describe("chrome.sh sin .env", () => {
	const chrome = (env: Record<string, string> = {}) =>
		run("bash", ["spikes/m0/chrome.sh"], {
			FCC_CHROME_DRY_RUN: "1",
			...env,
		});

	it("arranca con about:blank, sin avisos ni leer FIGMA_FILE_URL", () => {
		writeEnv(
			"FIGMA_FILE_URL=https://www.figma.com/design/abc/N?node-id=1&p=f\n",
		);
		const r = chrome();
		assert.equal(r.status, 0, r.stderr);
		const args = r.stdout.trim().split("\n");
		assert.ok(args.includes("about:blank"));
		assert.ok(!args.some((a) => a.includes("figma.com")));
		assert.ok(args.includes(`--remote-debugging-port=${sb.port}`));
		assert.ok(args.includes("--password-store=basic"));
		assert.ok(
			args.includes(
				`--user-data-dir=${sb.home}/.cache/figma-control-center-chrome`,
			),
		);
		assert.doesNotMatch(r.stderr, /FIGMA_FILE_URL|query/);
	});

	it("un .env con FCC_AGENT_TERMINAL=gnome-terminal -- no rompe el arranque y el puerto del .env manda", () => {
		writeEnv("FCC_AGENT_TERMINAL=gnome-terminal --\nFIGMA_CDP_PORT=9333\n");
		// El arnés fija un puerto libre en el entorno; vacío, manda el del .env (solo se imprime: modo de prueba)
		const r = chrome({ FIGMA_CDP_PORT: "" });
		assert.equal(r.status, 0, r.stderr);
		assert.ok(r.stdout.split("\n").includes("--remote-debugging-port=9333"));
	});
});

describe("chrome.sh comprueba que el Chrome es el suyo", () => {
	const OUR_PROFILE = () => `${sb.home}/.cache/figma-control-center-chrome`;
	const launch = (env: Record<string, string> = {}) =>
		sb.run("bash", ["spikes/m0/chrome.sh"], { dryRun: false, env });
	const chromeCalls = () =>
		sb.calls().filter((c) => c.tool === "google-chrome");

	it("con el puerto ocupado por otro proceso falla, nombra su pid y no dice «listo»", async () => {
		const other = await serveDebugPort(sb.port);
		try {
			const r = launch();
			assert.notEqual(r.status, 0, r.stdout);
			assert.doesNotMatch(r.stdout, /listo/);
			assert.match(r.stderr, new RegExp(`pid ${other.pid}\\b`));
			assert.equal(chromeCalls().length, 0, "no lanza otro Chrome encima");
		} finally {
			await other.stop();
		}
	});

	it("con el puerto de otro Chrome con otro perfil (p. ej. chrome-devtools-mcp) también falla", async () => {
		const other = await serveDebugPort(sb.port, `${sb.home}/otro-perfil`);
		try {
			const r = launch();
			assert.notEqual(r.status, 0, r.stdout);
			assert.match(r.stderr, new RegExp(`pid ${other.pid}\\b`));
			assert.match(r.stderr, /otro-perfil/);
		} finally {
			await other.stop();
		}
	});

	it("con el nuestro ya en marcha dice que ya estaba y sale 0, sin lanzar otro", async () => {
		const ours = await serveDebugPort(sb.port, OUR_PROFILE());
		try {
			const r = launch();
			assert.equal(r.status, 0, r.stderr);
			assert.match(r.stdout, /ya estaba en marcha/);
			assert.equal(chromeCalls().length, 0);
		} finally {
			await ours.stop();
		}
	});

	it("reconoce al nuestro aunque Chrome reescriba su título (la orden llega como una sola cadena)", async () => {
		const ours = await serveDebugPort(sb.port, OUR_PROFILE(), {
			rewriteTitle: true,
		});
		try {
			const r = launch();
			assert.equal(r.status, 0, r.stderr);
			assert.match(r.stdout, /ya estaba en marcha/);
		} finally {
			await ours.stop();
		}
	});

	it("tras lanzar, «listo» si contesta el proceso lanzado", () => {
		const r = launch({ FAKE_CHROME_MODE: "serve" });
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /Chrome listo/);
		assert.equal(chromeCalls().length, 1);
	});

	it("tras lanzar, si contesta otro proceso que no es el lanzado, falla y lo dice", () => {
		const r = launch({ FAKE_CHROME_MODE: "serve-other" });
		assert.notEqual(r.status, 0, r.stdout);
		assert.doesNotMatch(r.stdout, /listo/);
		assert.match(r.stderr, /otro proceso|no es el suyo|pid/);
	});
});

describe("login.sh y Makefile sin .env", () => {
	it("login.sh sin .env y con uno de valores con espacios no falla antes de lanzar Chrome", () => {
		for (const text of [null, "FCC_AGENT_TERMINAL=gnome-terminal --\n"]) {
			if (text !== null) writeEnv(text);
			const r = run("bash", ["spikes/m0/login.sh"], {
				FCC_CHROME_DRY_RUN: "1",
			});
			assert.equal(r.status, 0, r.stderr);
			assert.ok(r.stdout.split("\n").includes("https://www.figma.com/login"));
		}
	});

	it("make login-url no depende del .env: vuelve a la página de archivos de Figma", () => {
		writeEnv("FCC_AGENT_TERMINAL=gnome-terminal --\n");
		const r = run("make", ["-s", "login-url"]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /redirect_uri=%2Ffiles/);
	});

	it("ni el Makefile ni los scripts hacen source del .env", () => {
		const r = run("rg", [
			"-n",
			"source .*\\.env|ENV_FILE\\)",
			"Makefile",
			"spikes/m0",
		]);
		assert.doesNotMatch(r.stdout, /source/);
	});
});
