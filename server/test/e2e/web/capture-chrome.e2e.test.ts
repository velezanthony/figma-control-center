// El Chrome de captura y su pestaña (adapters/web) contra una web local
// mínima, con el Chromium de Playwright como FCC_WEB_CHROME_BIN. Necesita navegador: corre con `make e2e`, no con
// `make check` (como los tests del kit, D-5). Nunca usa el Chrome de Figma ni el 9222.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
	type CaptureChrome,
	launchCaptureChrome,
} from "#adapters/web/capture-chrome.ts";
import { CapturePage } from "#adapters/web/capture-page.ts";
import type { OutgoingMessage } from "#adapters/web/cdp-connection.ts";
import { captureScreen } from "#adapters/web/chrome-web-capturer.ts";
import { KIT_BUNDLE, PROFILE_PREFIX } from "#adapters/web/protocol.ts";
import { captureChromeBin } from "../../harness/capture-chrome-bin.ts";
import {
	freePort,
	MINI_PASSWORD,
	MINI_USER,
	type MiniWeb,
	startMiniWeb,
} from "./mini-web.ts";

let BIN: string;
let binDir: string;
const KIT = readFileSync(KIT_BUNDLE, "utf8");
const VIEWPORT = { w: 1000, h: 700 } as const;
const TIMEOUT_MS = 15_000;
const LOGIN = {
	path: "/entrar/",
	fields: { user: "#usuario", password: "#clave" },
} as const;

let web: MiniWeb;
let profileDir: string;
let chrome: CaptureChrome | null = null;
let sent: OutgoingMessage[] = [];

before(async () => {
	web = await startMiniWeb();
	binDir = await mkdtemp(join(tmpdir(), "chromium-captura-"));
	BIN = await captureChromeBin(binDir);
});
after(async () => {
	await web?.close();
	await rm(binDir, { recursive: true, force: true });
});
beforeEach(async () => {
	profileDir = await mkdtemp(join(tmpdir(), "perfiles-captura-"));
	sent = [];
});
afterEach(async () => {
	const open = chrome;
	chrome = null;
	await open?.close();
	await rm(profileDir, { recursive: true, force: true });
});

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

async function launch(screenScale = 1) {
	const r = await launchCaptureChrome({
		bin: BIN,
		port: await freePort(),
		profileDir,
		screenScale,
		viewport: VIEWPORT,
		timeoutMs: TIMEOUT_MS,
		trace: (m) => sent.push(m),
	});
	assert.ok(r.ok, r.ok ? "" : r.error.message);
	chrome = r.value;
	return r.value;
}

async function openPage(devicePixelRatio = 1) {
	const c = chrome ?? (await launch());
	const p = await CapturePage.open(c, {
		baseUrl: web.url,
		viewport: VIEWPORT,
		devicePixelRatio,
		timeoutMs: TIMEOUT_MS,
		kitSource: KIT,
	});
	assert.ok(p.ok, p.ok ? "" : p.error.message);
	return p.value;
}

describe("Chrome de captura: lanzar y limpiar", () => {
	it("lanza con la escala del proyecto, la ventana y un perfil temporal; el viewport y el dpr son los emulados", async () => {
		const c = await launch(1.25);
		// Chrome reescribe su título de proceso: los argumentos salen en una sola cadena
		const cmdline = readFileSync(`/proc/${c.pid}/cmdline`, "utf8").replaceAll(
			"\0",
			" ",
		);
		assert.ok(cmdline.includes("--force-device-scale-factor=1.25"), cmdline);
		assert.ok(cmdline.includes("--window-size=1000,700"), cmdline);
		assert.ok(c.profile.startsWith(join(profileDir, PROFILE_PREFIX)));
		const page = await openPage(1);
		assert.ok((await page.navigate("/")).ok);
		const view = await page.evaluateInPage(
			"[Math.round(devicePixelRatio * 1000) / 1000, innerWidth, innerHeight]",
		);
		assert.deepEqual(view.ok && view.value, [1, 1000, 700]);
	});

	it("al cerrar no queda el proceso ni el perfil", async () => {
		const c = await launch();
		const { pid, profile } = c;
		await c.close();
		chrome = null;
		assert.equal(isAlive(pid), false);
		assert.equal(existsSync(profile), false);
	});

	it("si el puerto ya contesta, no lanza otro encima: error con lo que contesta y sin perfil", async () => {
		const busy = createServer((_q, s) =>
			s.end(
				JSON.stringify({ webSocketDebuggerUrl: "ws://x", Browser: "Otro/1.0" }),
			),
		);
		await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
		const port = (busy.address() as { port: number }).port;
		try {
			const r = await launchCaptureChrome({
				bin: BIN,
				port,
				profileDir,
				screenScale: 1,
				viewport: VIEWPORT,
				timeoutMs: TIMEOUT_MS,
			});
			assert.equal(r.ok, false);
			assert.equal(!r.ok && r.error.type, "WebPageError");
			assert.match(
				!r.ok ? r.error.message : "",
				new RegExp(`${port}[\\s\\S]*Otro/1\\.0`),
			);
			assert.deepEqual(await readdir(profileDir), []);
		} finally {
			await new Promise((r) => busy.close(r));
		}
	});

	it("un binario que no existe es un error y no deja perfil", async () => {
		const r = await launchCaptureChrome({
			bin: join(profileDir, "no-existe"),
			port: await freePort(),
			profileDir,
			screenScale: 1,
			viewport: VIEWPORT,
			timeoutMs: TIMEOUT_MS,
		});
		assert.equal(!r.ok && r.error.type, "WebPageError");
		assert.deepEqual(await readdir(profileDir), []);
	});

	it("borra los perfiles huérfanos de una captura que murió a medias", async () => {
		await mkdir(join(profileDir, `${PROFILE_PREFIX}huerfano`));
		await mkdir(join(profileDir, "otra-cosa"));
		const c = await launch();
		assert.deepEqual(
			(await readdir(profileDir)).sort(),
			[c.profile.split("/").pop(), "otra-cosa"].sort(),
		);
	});
});

describe("pestaña de captura: mundo aislado, guarda, acciones", () => {
	it("el kit vive en el mundo aislado: la página no lo ve y el kit no ve las variables de la app", async () => {
		const page = await openPage();
		assert.ok((await page.navigate("/")).ok);
		const inPage = await page.evaluateInPage(
			"[typeof window.__figmaCaptureKit, window.app.estado]",
		);
		assert.deepEqual(inPage.ok && inPage.value, ["undefined", "listo"]);
		const seen = await page.until("typeof app !== 'undefined'", 200);
		assert.equal(!seen.ok && seen.error.type, "StateNotReached");
		const captured = await page.kit("capture", {
			screen: { key: "p", title: "P", url: "/" },
			variant: { props: {} },
			allowPageWorld: false,
			imgHi: true,
		});
		assert.ok(captured.ok);
		assert.ok(JSON.stringify(captured.value).includes("Portada"));
	});

	it("un clic abre el menú y until llega; una condición que no se cumple da StateNotReached", async () => {
		const page = await openPage();
		assert.ok((await page.navigate("/")).ok);
		assert.ok((await page.click("#abrir")).ok);
		assert.ok(
			(await page.until("!document.getElementById('menu').hidden", 2000)).ok,
		);
		const never = await page.until("document.getElementById('nunca')", 300);
		assert.equal(!never.ok && never.error.type, "StateNotReached");
	});

	it("navegar fuera de baseUrl, o un clic que sale, es WebPageError (navigation) y no se sigue", async () => {
		const page = await openPage();
		const direct = await page.navigate("http://fuera.invalid/");
		assert.equal(
			!direct.ok && direct.error.type === "WebPageError" && direct.error.reason,
			"navigation",
		);
		assert.ok((await page.navigate("/")).ok);
		const click = await page.click("#fuera");
		assert.equal(
			!click.ok && click.error.type === "WebPageError" && click.error.reason,
			"navigation",
		);
		// La navegación cortada nunca llega a la otra web (Chrome se queda en su página de error, y la captura acaba)
		const href = await page.evaluateInPage("location.href");
		assert.doesNotMatch(String(href.ok && href.value), /fuera\.invalid/);
	});

	it("una página que responde un error HTTP (404) es WebPageError (load) con el código: no se captura su contenido", async () => {
		const page = await openPage();
		const r = await page.navigate("/no-existe/");
		assert.equal(
			!r.ok && r.error.type === "WebPageError" && r.error.reason,
			"load",
		);
		assert.match(!r.ok ? JSON.stringify(r.error) : "", /HTTP 404/);
	});

	it("un clic que navega dentro de baseUrl sigue con el kit reinstalado", async () => {
		const page = await openPage();
		assert.ok((await page.navigate("/")).ok);
		assert.ok((await page.click("#interna")).ok);
		const captured = await page.kit("capture", {
			screen: { key: "o", title: "O", url: "/otra/" },
			variant: { props: {} },
			allowPageWorld: false,
			imgHi: true,
		});
		assert.ok(captured.ok && JSON.stringify(captured.value).includes("Otra"));
	});
});

describe("pestaña de captura: login por formulario", () => {
	it("con la contraseña buena entra y llega a la página privada", async () => {
		const page = await openPage();
		const r = await page.login(LOGIN, MINI_USER, MINI_PASSWORD);
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		const href = await page.evaluateInPage("location.pathname");
		assert.equal(href.ok && href.value, "/privado/");
		assert.ok((await page.navigate("/privado/")).ok);
	});

	it("con una contraseña mala es WebPageError con motivo login", async () => {
		const page = await openPage();
		const r = await page.login(LOGIN, MINI_USER, "mala");
		assert.equal(
			!r.ok && r.error.type === "WebPageError" && r.error.reason,
			"login",
		);
	});

	it("la contraseña viaja solo como argumento de callFunctionOn: nunca en el texto de un script", async () => {
		const page = await openPage();
		await page.login(LOGIN, MINI_USER, MINI_PASSWORD);
		const texts = sent.flatMap((m) =>
			[m.params["expression"], m.params["functionDeclaration"]].filter(
				(t) => typeof t === "string",
			),
		);
		assert.ok(texts.length > 0);
		for (const t of texts)
			assert.equal(String(t).includes(MINI_PASSWORD), false);
		const asArgument = sent.filter(
			(m) =>
				m.method === "Runtime.callFunctionOn" &&
				JSON.stringify(m.params["arguments"]).includes(MINI_PASSWORD),
		);
		assert.equal(asArgument.length, 1);
	});
});

describe("hojas de componentes: query por variante y viewport por pantalla", () => {
	const request = () => ({
		web: {
			baseUrl: web.url,
			viewport: VIEWPORT,
			screenScale: 1,
			devicePixelRatio: 1,
			login: null,
			strip: [],
			hideScrollbar: true,
		},
		screens: [],
		users: new Map(),
		hooks: null,
		allowPageWorld: false,
		pageTimeoutMs: TIMEOUT_MS,
	});

	it("navega a la query de cada variante, captura cada tamaño y deja el viewport del proyecto", async () => {
		const page = await openPage();
		const r = await captureScreen(
			page,
			request(),
			{
				key: "cmp-uno",
				title: "Uno",
				url: "/componente/",
				pick: "#cmp",
				viewport: { w: 400, h: 300 },
				variants: [
					{ props: { size: "sm" }, query: { size: "sm" } },
					{ props: { size: "lg" }, query: { size: "lg" } },
				],
			},
			true,
		);
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.match(r.value.url, /\/componente\/\?size=lg$/);
		const widths = r.value.variants.map((v) => (v.nodes[0] as { w: number }).w);
		assert.deepEqual(widths, [80, 200]);
		const view = await page.evaluateInPage("[innerWidth, innerHeight]");
		assert.deepEqual(view.ok && view.value, [1000, 700]);
	});

	it("durante la captura el viewport es el de la pantalla", async () => {
		const page = await openPage();
		const seen: unknown[] = [];
		const r = await captureScreen(
			page,
			request(),
			{
				key: "cmp-dos",
				title: "Dos",
				url: "/componente/",
				viewport: { w: 400, h: 300 },
				variants: [
					{ props: {}, query: { size: "sm" }, run: [{ click: "#cmp" }] },
				],
				until: "innerWidth === 400",
			},
			true,
		);
		seen.push(r.ok);
		assert.deepEqual(seen, [true]);
	});
});
