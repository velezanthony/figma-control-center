import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
} from "#domain/figma-error.ts";
import { CdpClient } from "./cdp-client.ts";
import { type FakeCdp, startFakeCdp } from "./testing/fake-cdp-server.ts";

const FILE_URL = "https://www.figma.com/design/KEY/Nombre";

const clientFor = (fake: { port: number }, overrides = {}) =>
	new CdpClient({
		host: "127.0.0.1",
		port: fake.port,
		fileUrl: FILE_URL,
		callTimeoutMs: 2000,
		readyTimeoutMs: 300,
		readyPollIntervalMs: 20,
		...overrides,
	});

const servers: FakeCdp[] = [];
const clients: CdpClient[] = [];
const start = async (options?: Parameters<typeof startFakeCdp>[0]) => {
	const fake = await startFakeCdp(options);
	servers.push(fake);
	return fake;
};
const track = (c: CdpClient) => {
	clients.push(c);
	return c;
};
after(async () => {
	for (const c of clients) c.close();
	for (const s of servers) await s.close();
});

describe("CdpClient", () => {
	it("evalúa una expresión y devuelve el valor", async () => {
		const fake = await start({ figma: { root: { name: "Archivo" } } });
		const r = await track(clientFor(fake)).evaluate("figma.root.name");
		assert.deepEqual(r, { ok: true, value: "Archivo" });
	});

	it("un script que no devuelve nada da null", async () => {
		const fake = await start({ figma: {} });
		const r = await track(clientFor(fake)).evaluate("undefined");
		assert.deepEqual(r, { ok: true, value: null });
	});

	it("espera a una promesa del script", async () => {
		const fake = await start({ figma: {} });
		const r = await track(clientFor(fake)).evaluate("Promise.resolve(41 + 1)");
		assert.deepEqual(r, { ok: true, value: 42 });
	});

	it("Chrome parado da ChromeUnreachable", async () => {
		const fake = await startFakeCdp();
		const { port } = fake;
		await fake.close();
		const r = await clientFor({ port }).evaluate("1");
		assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.chromeUnreachable);
	});

	it("sin pestaña del archivo da FigmaTabNotFound", async () => {
		const fake = await start({ tabUrl: "https://otro.example/x" });
		const r = await track(clientFor(fake)).evaluate("1");
		assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.figmaTabNotFound);
	});

	it("si figma no aparece en el plazo da FigmaNotReady", async () => {
		const fake = await start();
		const r = await track(clientFor(fake)).evaluate("1");
		assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.figmaNotReady);
	});

	describe("la espera a `figma` pregunta lo mismo que figma_status", () => {
		// Señales medidas en el archivo de pruebas sin sesión: figma no existe, la ruta sigue en /design/… y no hay user_data
		const NO_SESSION = {
			location: { pathname: "/design/KEY/Nombre" },
			INITIAL_OPTIONS: { editing_file: { can_edit: false } },
		};
		const READ_ONLY = {
			location: { pathname: "/design/KEY/Nombre" },
			INITIAL_OPTIONS: { user_data: {}, editing_file: { can_edit: false } },
		};
		const waited = async (
			globals: Record<string, unknown>,
			readyTimeoutMs = 1500,
		) => {
			const fake = await start({ globals });
			const started = performance.now();
			const r = await track(clientFor(fake, { readyTimeoutMs })).evaluate("1");
			return { r, ms: performance.now() - started, fake };
		};

		it("sin sesión falla en el acto con notLoggedIn, sin esperar el plazo", async () => {
			const { r, ms, fake } = await waited(NO_SESSION);
			assert.ok(!r.ok);
			assert.equal(r.error.type, FIGMA_ERROR_TYPE.figmaNotReady);
			assert.equal(
				r.error.type === FIGMA_ERROR_TYPE.figmaNotReady && r.error.reason,
				FIGMA_NOT_READY_REASON.notLoggedIn,
			);
			assert.ok(ms < 700, `tardó ${ms} ms`);
			assert.equal(
				fake.expressions.includes("1"),
				false,
				"el script no se envía a la pestaña",
			);
		});

		it("con permiso de solo lectura falla en el acto con viewOnly", async () => {
			const { r, ms } = await waited(READ_ONLY);
			assert.ok(!r.ok);
			assert.equal(
				r.error.type === FIGMA_ERROR_TYPE.figmaNotReady && r.error.reason,
				FIGMA_NOT_READY_REASON.viewOnly,
			);
			assert.ok(ms < 700, `tardó ${ms} ms`);
		});

		it("cargando sigue esperando hasta el plazo y da loading", async () => {
			const { r, ms } = await waited({}, 300);
			assert.ok(!r.ok);
			assert.equal(
				r.error.type === FIGMA_ERROR_TYPE.figmaNotReady && r.error.reason,
				FIGMA_NOT_READY_REASON.loading,
			);
			assert.ok(ms >= 250, `tardó solo ${ms} ms`);
		});
	});

	it("waitReady:false no espera a figma", async () => {
		const fake = await start();
		const r = await track(clientFor(fake)).evaluate("typeof figma", {
			waitReady: false,
		});
		assert.deepEqual(r, { ok: true, value: "undefined" });
	});

	it("error de sintaxis: ScriptError con línea del código del usuario y retryable", async () => {
		const fake = await start({ figma: {} });
		const r = await track(clientFor(fake)).evaluate(
			"(async () => {\nconst a = 1;\nconst b = ;\n})()",
			{ lineOffset: 1 },
		);
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptError);
		assert.equal(
			r.error.type === FIGMA_ERROR_TYPE.scriptError && r.error.line,
			2,
		);
		assert.equal(r.error.retryable, false);
	});

	it("error de ejecución: ScriptError con línea y no reintentable", async () => {
		const fake = await start({ figma: {} });
		const r = await track(clientFor(fake)).evaluate(
			"(async () => {\nconst a = 1;\nnull.x;\n})()",
			{ lineOffset: 1 },
		);
		assert.ok(!r.ok);
		assert.equal(
			r.error.type === FIGMA_ERROR_TYPE.scriptError && r.error.line,
			2,
		);
		assert.equal(r.error.retryable, false);
	});

	it("una llamada más larga que el plazo da Timeout", async () => {
		const fake = await start({ figma: {} });
		const client = track(clientFor(fake, { readyTimeoutMs: 100 }));
		assert.equal((await client.evaluate("1")).ok, true);
		fake.expressions.length = 0;
		const hung = await start({ figma: {}, hang: true });
		const r = await track(clientFor(hung, { callTimeoutMs: 100 })).evaluate(
			"1",
		);
		assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.timeout);
	});

	it("el timeoutMs de la llamada manda sobre el general", async () => {
		const hung = await start({ figma: {}, hang: true });
		const r = await track(clientFor(hung)).evaluate("1", {
			timeoutMs: 80,
			waitReady: false,
		});
		assert.equal(
			!r.ok && r.error.type === FIGMA_ERROR_TYPE.timeout && r.error.timeoutMs,
			80,
		);
	});

	it("envía un script de 4 MB entero", async () => {
		const fake = await start({ figma: {} });
		const big = "x".repeat(4_000_000);
		const r = await track(clientFor(fake)).evaluate(`"${big}".length`);
		assert.deepEqual(r, { ok: true, value: 4_000_000 });
	});

	it("CA-5: dos tenants sobre el mismo Chrome descubren cada uno su pestaña por su fileUrl", async () => {
		const A = "https://www.figma.com/design/AAA/ProyectoA";
		const B = "https://www.figma.com/design/BBB/ProyectoB";
		const fake = await start({ tabUrls: [A, B] });
		const tabA = await track(clientFor(fake, { fileUrl: A })).discoverTab();
		const tabB = await track(clientFor(fake, { fileUrl: B })).discoverTab();
		assert.ok(tabA.ok);
		assert.ok(tabB.ok);
		// Mismo puerto (mismo Chrome), pero cada uno su pestaña (su webSocketDebuggerUrl)
		assert.ok(tabA.value.webSocketDebuggerUrl.endsWith("/page/1"));
		assert.ok(tabB.value.webSocketDebuggerUrl.endsWith("/page/2"));
		assert.notEqual(
			tabA.value.webSocketDebuggerUrl,
			tabB.value.webSocketDebuggerUrl,
		);
	});

	describe("la pestaña se elige por la clave del archivo", () => {
		const discover = async (configured: string, tabs: readonly string[]) => {
			const fake = await start({ tabUrls: tabs });
			return track(clientFor(fake, { fileUrl: configured })).discoverTab();
		};

		for (const tab of [
			"https://www.figma.com/design/KEY",
			"https://www.figma.com/design/KEY/Otro-nombre?node-id=1-2",
			"https://www.figma.com/file/KEY/Nombre",
			"https://www.figma.com/file/KEY",
		]) {
			it(`${tab} es la pestaña de https://www.figma.com/design/KEY/Nombre`, async () => {
				assert.ok((await discover(FILE_URL, [tab])).ok);
			});
		}

		it("una clave que es prefijo de otra no casa con el otro archivo", async () => {
			const r = await discover("https://www.figma.com/design/KEY", [
				"https://www.figma.com/design/KEYLARGA/Otro",
			]);
			assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.figmaTabNotFound);
		});

		it("con varias pestañas elige la de su clave aunque otra se parezca", async () => {
			const r = await discover("https://www.figma.com/design/KEY", [
				"https://www.figma.com/design/KEYLARGA/Otro",
				"https://www.figma.com/design/KEY/Nombre",
			]);
			assert.ok(r.ok);
			assert.ok(r.value.webSocketDebuggerUrl.endsWith("/page/2"));
		});
	});

	describe("un script que venció su plazo", () => {
		const SLOW = "/*lento*/ 1";
		const gatedFake = () =>
			start({
				figma: {},
				respond: (expression) =>
					expression.includes("/*lento*/")
						? {
								kind: "gated",
								gate: "viejo",
								afterRelease: { kind: "value", value: 1 },
							}
						: undefined,
			});

		it("sin ningún script vencido no hay nada pendiente", async () => {
			const fake = await start({ figma: {} });
			const client = track(clientFor(fake));
			await client.evaluate("1");
			assert.equal(client.orphanedScript(), undefined);
		});

		it("sigue pendiente tras el Timeout y se resuelve cuando llega su respuesta", async () => {
			const fake = await gatedFake();
			const client = track(clientFor(fake));
			const r = await client.evaluate(SLOW, { timeoutMs: 50 });
			assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.timeout);

			const pending = client.orphanedScript();
			assert.notEqual(pending, undefined);
			let settled = false;
			void pending?.then(() => {
				settled = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 30));
			assert.equal(settled, false);

			fake.release("viejo");
			await pending;
			assert.equal(client.orphanedScript(), undefined);
		});

		it("se resuelve si la pestaña se cierra (el script muere con ella)", async () => {
			const fake = await startFakeCdp({
				figma: {},
				respond: () => ({ kind: "hang" }),
			});
			const client = track(clientFor(fake, { readyTimeoutMs: 100 }));
			// Con `hang` ni la sonda de `figma` responde: se usa un script sin esperar a la sonda
			const r = await client.evaluate(SLOW, {
				timeoutMs: 50,
				waitReady: false,
			});
			assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.timeout);
			const pending = client.orphanedScript();
			assert.notEqual(pending, undefined);
			await fake.close();
			await pending;
			assert.equal(client.orphanedScript(), undefined);
		});
	});
});

// D-2 B: sin la pestaña del proyecto, el servidor la abre (PUT /json/new) con guardas
describe("CdpClient: abrir la pestaña del proyecto si no está", () => {
	const OTHER_URL = "https://www.figma.com/design/OTRO/Otro";
	// Un mutex en memoria hace de `withLock` (el de verdad, entre procesos, se prueba en fs-open-lock.int.test.ts)
	const mutex = () => {
		let tail: Promise<unknown> = Promise.resolve();
		return {
			withLock: <T>(_key: string, run: () => Promise<T>): Promise<T> => {
				const next = tail.then(run, run);
				tail = next.catch(() => {});
				return next;
			},
		};
	};
	const openingClient = (fake: { port: number }, openTab = mutex()) =>
		track(clientFor(fake, { openTab }));

	it("sin la pestaña, la primera llamada la abre con PUT, la espera y lo dice una sola vez", async () => {
		const fake = await start({ figma: {}, tabUrls: [] });
		const client = openingClient(fake);
		const r = await client.evaluate("1");
		assert.deepEqual(r, { ok: true, value: 1 });
		assert.deepEqual(fake.tabRequests, [
			`PUT /json/new?${encodeURIComponent(FILE_URL)}`,
		]);
		assert.deepEqual(fake.tabs(), [FILE_URL]);
		assert.match(client.takeOpenedNotice() ?? "", /abrió la pestaña/);
		assert.equal(client.takeOpenedNotice(), null);
	});

	it("con la pestaña ya abierta no abre otra", async () => {
		const fake = await start({ figma: {}, tabUrls: [`${FILE_URL}?node-id=1`] });
		const client = openingClient(fake);
		assert.deepEqual(await client.evaluate("1"), { ok: true, value: 1 });
		assert.deepEqual(fake.tabRequests, []);
		assert.equal(client.takeOpenedNotice(), null);
	});

	it("si Figma la lleva a otro archivo, la cierra y falla; no toca las pestañas que no abrió", async () => {
		const fake = await start({
			figma: {},
			tabUrls: [OTHER_URL],
			openedTabLandsOn: () => "https://www.figma.com/design/EQUIVOCADO/Otro",
		});
		const client = openingClient(fake);
		const r = await client.evaluate("1");
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.figmaTabNotFound);
		assert.match(r.error.message, /EQUIVOCADO/);
		assert.equal(client.takeOpenedNotice(), null);
		// Solo se cerró la que abrió; la ajena sigue
		assert.deepEqual(fake.tabs(), [OTHER_URL]);
		assert.equal(fake.tabRequests.filter((q) => q.startsWith("PUT")).length, 1);
		assert.equal(
			fake.tabRequests.filter((q) => q.includes("/json/close/")).length,
			1,
		);
	});

	it("dos sesiones a la vez abren una sola pestaña (la segunda vuelve a listar antes de abrir)", async () => {
		const fake = await start({ figma: {}, tabUrls: [] });
		const lock = mutex();
		const [a, b] = await Promise.all([
			openingClient(fake, lock).evaluate("1"),
			openingClient(fake, lock).evaluate("2"),
		]);
		assert.deepEqual(
			[a, b],
			[
				{ ok: true, value: 1 },
				{ ok: true, value: 2 },
			],
		);
		assert.equal(fake.tabRequests.filter((q) => q.startsWith("PUT")).length, 1);
		assert.equal(fake.tabs().length, 1);
	});

	it("sin la opción de abrir, sigue siendo FigmaTabNotFound y no pide nada a Chrome", async () => {
		const fake = await start({ figma: {}, tabUrls: [] });
		const r = await track(clientFor(fake)).evaluate("1");
		assert.equal(!r.ok && r.error.type, FIGMA_ERROR_TYPE.figmaTabNotFound);
		assert.deepEqual(fake.tabRequests, []);
	});
});
