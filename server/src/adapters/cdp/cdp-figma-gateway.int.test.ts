import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { SCRIPT_FORMAT } from "#application/ports/figma-gateway.ts";
import {
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
} from "#domain/figma-error.ts";
import { CdpClient } from "./cdp-client.ts";
import { CdpFigmaGateway } from "./cdp-figma-gateway.ts";
import { KIT_PROBE_EXPRESSION, readFigmaKitBundle } from "./figma-kit.ts";
import {
	FIGMA_ACCESS_EXPRESSION,
	FIGMA_KIT_GLOBAL,
	FIGMA_KIT_SHA_GLOBAL,
} from "./protocol.ts";
import { type FakeCdp, startFakeCdp } from "./testing/fake-cdp-server.ts";

const FILE_URL = "https://www.figma.com/design/KEY/Nombre";
const PNG_1X1_HEADER = Buffer.alloc(24);
PNG_1X1_HEADER.writeUInt32BE(300, 16);
PNG_1X1_HEADER.writeUInt32BE(150, 20);

type FakeNode = {
	id: string;
	name: string;
	type: string;
	parent?: FakeNode | null;
	children?: FakeNode[];
	exportAsync?: () => Promise<Uint8Array>;
	loadAsync?: () => Promise<void>;
};

const frame: FakeNode = {
	id: "1:2",
	name: "Frame",
	type: "FRAME",
	exportAsync: async () => PNG_1X1_HEADER,
	children: [],
};
const text: FakeNode = { id: "1:3", name: "Texto", type: "TEXT" };
frame.children = [text];
const page: FakeNode = {
	id: "0:1",
	name: "Inicio",
	type: "PAGE",
	children: [frame],
	loadAsync: async () => {},
};
frame.parent = page;
text.parent = frame;
const nodes = new Map([frame, text, page].map((n) => [n.id, n]));

const fakeFigma = {
	root: { name: "Archivo" },
	currentPage: page,
	getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
	base64Encode: (b: Uint8Array) => Buffer.from(b).toString("base64"),
	base64Decode: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
};

const servers: FakeCdp[] = [];
const clients: CdpClient[] = [];
const gatewayFor = async (
	figma: object | null = fakeFigma,
	globals: Readonly<Record<string, unknown>> = {},
) => {
	const fake = await startFakeCdp(
		figma === null ? { globals } : { figma, globals },
	);
	servers.push(fake);
	const client = new CdpClient({
		host: "127.0.0.1",
		port: fake.port,
		fileUrl: FILE_URL,
		callTimeoutMs: 2000,
		readyTimeoutMs: 200,
		readyPollIntervalMs: 20,
	});
	clients.push(client);
	return { gateway: new CdpFigmaGateway(client), fake };
};
after(async () => {
	for (const c of clients) c.close();
	for (const s of servers) await s.close();
});

describe("CdpFigmaGateway.run", () => {
	it("formato body: ejecuta el cuerpo y devuelve el return", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.run({
			code: "return figma.root.name;",
			format: SCRIPT_FORMAT.body,
		});
		assert.deepEqual(r, { ok: true, value: "Archivo" });
	});

	it("formato function: ejecuta async () => {…} aunque acabe en punto y coma", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.run({
			code: "async () => {\n  return figma.root.name;\n};",
			format: SCRIPT_FORMAT.function,
		});
		assert.deepEqual(r, { ok: true, value: "Archivo" });
	});

	it("el script recibe params y assets como Uint8Array en los dos formatos (CA-7)", async () => {
		const { gateway } = await gatewayFor();
		const body = await gateway.run({
			code: "return { page: params.page, bytes: assets.mapa.length };",
			format: SCRIPT_FORMAT.body,
			params: { page: "App" },
			assets: { mapa: Uint8Array.from([1, 2, 3, 4]) },
		});
		assert.deepEqual(body, {
			ok: true,
			value: { page: "App", bytes: 4 },
		});

		const fn = await gateway.run({
			code: "async (params, assets) => ({ n: params.n, bytes: assets.logo.length })",
			format: SCRIPT_FORMAT.function,
			params: { n: 7 },
			assets: { logo: Uint8Array.from([9, 9]) },
		});
		assert.deepEqual(fn, { ok: true, value: { n: 7, bytes: 2 } });
	});

	it("un error de sintaxis en formato function da la línea del script", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.run({
			code: "async () => {\n  const a = 1;\n  const b = ;\n  return a;\n}",
			format: SCRIPT_FORMAT.function,
		});
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.equal(r.error.line, 3);
		assert.equal(r.error.retryable, false);
	});
});

describe("CdpFigmaGateway.run con el kit de Figma", () => {
	const user = { installKit: true } as const;
	const BUNDLE = readFigmaKitBundle();
	const isProbe = (e: string) => e === KIT_PROBE_EXPRESSION;
	const isInstall = (e: string) => e.includes(BUNDLE.source);
	const kitCalls = (fake: FakeCdp) => ({
		probes: fake.expressions.filter(isProbe).length,
		installs: fake.expressions.filter(isInstall).length,
	});

	it("los nombres de los globales son los del kit (que no puede importarse)", async () => {
		const { KIT_GLOBAL, KIT_SHA_GLOBAL } = await import(
			"../../../../kits/figma/types.ts"
		);
		assert.equal(FIGMA_KIT_GLOBAL, KIT_GLOBAL);
		assert.equal(FIGMA_KIT_SHA_GLOBAL, KIT_SHA_GLOBAL);
	});

	it("body y function reciben `kit`: pregunta, instala y vuelve a preguntar antes del script", async () => {
		const { gateway, fake } = await gatewayFor();
		const body = await gateway.run(
			{ code: "return kit.version;", format: SCRIPT_FORMAT.body },
			user,
		);
		assert.deepEqual(body, { ok: true, value: "figma-kit@1" });
		const fn = await gateway.run(
			{
				code: "async (params, assets, kit) => kit.sha256",
				format: SCRIPT_FORMAT.function,
			},
			user,
		);
		assert.deepEqual(fn, { ok: true, value: BUNDLE.sha256 });
		const [first, second, third] = fake.expressions.filter(
			(e) => e !== FIGMA_ACCESS_EXPRESSION,
		);
		assert.equal(first, KIT_PROBE_EXPRESSION);
		assert.equal(isInstall(second ?? ""), true);
		assert.equal(third, KIT_PROBE_EXPRESSION);
	});

	it("el kit se instala una vez: la segunda llamada solo pregunta", async () => {
		const { gateway, fake } = await gatewayFor();
		const run = () =>
			gateway.run({ code: "return 1;", format: SCRIPT_FORMAT.body }, user);
		await run();
		await run();
		await run();
		assert.deepEqual(kitCalls(fake), { probes: 4, installs: 1 });
	});

	it("si la pestaña se recarga (el kit desaparece) se instala otra vez", async () => {
		const { gateway, fake } = await gatewayFor();
		const run = (code: string) =>
			gateway.run({ code, format: SCRIPT_FORMAT.body }, user);
		await run("return 1;");
		await run(`delete globalThis.${FIGMA_KIT_GLOBAL}; return 2;`);
		assert.equal(kitCalls(fake).installs, 1);
		const third = await run("return kit.version;");
		assert.deepEqual(third, { ok: true, value: "figma-kit@1" });
		assert.equal(kitCalls(fake).installs, 2);
	});

	it("si la pestaña tiene otro hash (kit nuevo) se reinstala", async () => {
		const { gateway, fake } = await gatewayFor();
		const run = (code: string) =>
			gateway.run({ code, format: SCRIPT_FORMAT.body }, user);
		await run("return 1;");
		await run(
			`globalThis.${FIGMA_KIT_GLOBAL} = { version: "figma-kit@1", sha256: "otro" }; return 2;`,
		);
		const r = await run("return kit.sha256;");
		assert.deepEqual(r, { ok: true, value: BUNDLE.sha256 });
		assert.equal(kitCalls(fake).installs, 2);
	});

	it("los scripts internos (estado, captura, metadatos) no preguntan ni instalan nada", async () => {
		const { gateway, fake } = await gatewayFor();
		await gateway.screenshot("1:2", 1);
		await gateway.metadata("1:2", 1);
		await gateway.run({ code: "return 1;", format: SCRIPT_FORMAT.body });
		await gateway.status();
		assert.deepEqual(kitCalls(fake), { probes: 0, installs: 0 });
	});

	it("si tras instalar la pestaña sigue sin el kit, es un error y el script no se envía", async () => {
		const fake = await startFakeCdp({ figma: fakeFigma });
		servers.push(fake);
		const client = new CdpClient({
			host: "127.0.0.1",
			port: fake.port,
			fileUrl: FILE_URL,
			callTimeoutMs: 2000,
			readyTimeoutMs: 200,
			readyPollIntervalMs: 20,
		});
		clients.push(client);
		const gateway = new CdpFigmaGateway(client, () => ({
			version: "figma-kit@1",
			sha256: "x",
			source: "1;",
		}));
		const r = await gateway.run(
			{ code: "return 'enviado';", format: SCRIPT_FORMAT.body },
			user,
		);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.error.message, /kit de Figma/);
		assert.equal(
			fake.expressions.some((e) => e.includes("enviado")),
			false,
		);
	});

	it("si el empaquetado no se puede leer, el error manda a generarlo", async () => {
		const fake = await startFakeCdp({ figma: fakeFigma });
		servers.push(fake);
		const client = new CdpClient({
			host: "127.0.0.1",
			port: fake.port,
			fileUrl: FILE_URL,
			callTimeoutMs: 2000,
			readyTimeoutMs: 200,
		});
		clients.push(client);
		const gateway = new CdpFigmaGateway(client, () => {
			throw new Error("ENOENT");
		});
		const r = await gateway.run(
			{ code: "return 1;", format: SCRIPT_FORMAT.body },
			user,
		);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.error.message, /npm run build:kit/);
	});

	it("kit.fail dentro de un paso: ScriptError con el código, la línea del paso y el siguiente paso del kit", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.run(
			{
				code: "const a = 1;\nkit.fail('SIN_SET', 'No hay set', 'Mira figma_components');",
				format: SCRIPT_FORMAT.body,
			},
			user,
		);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.equal(r.error.message, "SIN_SET: No hay set (línea 2)");
		assert.equal(r.error.line, 2);
		assert.equal(r.error.nextStep, "Mira figma_components");
	});

	it("un error que salta DENTRO del kit da la línea del paso, no la del empaquetado", async () => {
		// El `figma` de este doble no tiene `root.children`: la pieza revienta dentro del kit
		const { gateway } = await gatewayFor();
		const r = await gateway.run(
			{
				code: "const a = 1;\nconst b = 2;\nawait kit.page.find('X');",
				format: SCRIPT_FORMAT.body,
			},
			user,
		);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.equal(r.error.line, 3);
	});

	it("un `body` que declara su propio `kit` no compila (SyntaxError con su línea)", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.run(
			{ code: "const kit = 1;\nreturn kit;", format: SCRIPT_FORMAT.body },
			user,
		);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.error.message, /kit/);
	});
});

describe("CdpFigmaGateway.status", () => {
	it("con todo listo informa archivo y página", async () => {
		const { gateway } = await gatewayFor();
		assert.deepEqual(await gateway.status(), {
			chromeReachable: true,
			tabFound: true,
			figmaReady: true,
			fileName: "Archivo",
			pageName: "Inicio",
			error: null,
		});
	});

	it("con Chrome parado informa ChromeUnreachable", async () => {
		const fake = await startFakeCdp();
		const { port } = fake;
		await fake.close();
		const gateway = new CdpFigmaGateway(
			new CdpClient({
				host: "127.0.0.1",
				port,
				fileUrl: FILE_URL,
				callTimeoutMs: 500,
				readyTimeoutMs: 100,
			}),
		);
		const s = await gateway.status();
		assert.equal(s.chromeReachable, false);
		assert.equal(s.error?.type, FIGMA_ERROR_TYPE.chromeUnreachable);
		assert.match(s.error?.nextStep ?? "", /chrome\.sh/);
	});

	it("sin figma informa FigmaNotReady sin esperar", async () => {
		const { gateway } = await gatewayFor(null);
		const s = await gateway.status();
		assert.equal(s.chromeReachable && s.tabFound, true);
		assert.equal(s.figmaReady, false);
		assert.equal(s.error?.type, FIGMA_ERROR_TYPE.figmaNotReady);
	});

	// Forma de window.INITIAL_OPTIONS que se vio en la pestaña real (solo los campos que se leen)
	const loggedIn = (canEdit: boolean) => ({
		INITIAL_OPTIONS: {
			user_data: { id: "123" },
			editing_file: { can_edit: canEdit },
		},
	});

	it("con sesión pero solo permiso de lectura dice que pidas edición o dupliques el archivo", async () => {
		const { gateway } = await gatewayFor(null, loggedIn(false));
		const s = await gateway.status();
		assert.ok(s.error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(s.error.reason, FIGMA_NOT_READY_REASON.viewOnly);
		assert.equal(s.error.retryable, true);
		assert.match(s.error.nextStep, /permiso de edición/);
		assert.match(s.error.nextStep, /persona/);
	});

	it("sin sesión iniciada dice que ejecutes make login", async () => {
		const { gateway } = await gatewayFor(null, {
			INITIAL_OPTIONS: { user_data: null },
		});
		const s = await gateway.status();
		assert.ok(s.error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(s.error.reason, FIGMA_NOT_READY_REASON.notLoggedIn);
		assert.equal(s.error.retryable, true);
		assert.match(s.error.nextStep, /make login/);
	});

	it("si la pestaña acabó en /login también es falta de sesión", async () => {
		const { gateway } = await gatewayFor(null, {
			location: { pathname: "/login" },
		});
		const s = await gateway.status();
		assert.ok(s.error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(s.error.reason, FIGMA_NOT_READY_REASON.notLoggedIn);
	});

	it("con sesión y permiso de edición pero sin figma todavía: el editor está cargando", async () => {
		const { gateway } = await gatewayFor(null, loggedIn(true));
		const s = await gateway.status();
		assert.ok(s.error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(s.error.reason, FIGMA_NOT_READY_REASON.loading);
		assert.equal(s.error.retryable, true);
		assert.match(s.error.nextStep, /cargando/);
	});

	it("sin señales de la página (aún sin INITIAL_OPTIONS) también es que está cargando", async () => {
		const { gateway } = await gatewayFor(null);
		const s = await gateway.status();
		assert.ok(s.error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(s.error.reason, FIGMA_NOT_READY_REASON.loading);
	});
});

describe("CdpFigmaGateway.screenshot", () => {
	it("devuelve los bytes del PNG y sus dimensiones", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.screenshot("1:2", 2);
		assert.ok(r.ok);
		assert.equal(r.value.width, 300);
		assert.equal(r.value.height, 150);
		assert.equal(r.value.png.length, 24);
	});

	it("un nodo inexistente da NodeNotFound con su id, sin línea y no reintentable", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.screenshot("9:9", 1);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.nodeNotFound);
		assert.equal(r.error.nodeId, "9:9");
		assert.equal(r.error.retryable, false);
		assert.doesNotMatch(r.error.message, /línea/);
		assert.match(r.error.nextStep, /figma_metadata/);
	});

	it("figma_metadata de un nodo inexistente también da NodeNotFound", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.metadata("9:9", 1);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.nodeNotFound);
		assert.equal(r.error.nodeId, "9:9");
	});

	it("un nodo no exportable da ScriptError", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.screenshot("1:3", 1);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.error.message, /no se puede exportar/);
	});
});

describe("CdpFigmaGateway.metadata", () => {
	it("sin nodeId devuelve la página actual con profundidad 1", async () => {
		const { gateway } = await gatewayFor();
		const r = await gateway.metadata(null, 1);
		assert.deepEqual(r, {
			ok: true,
			value: {
				id: "0:1",
				name: "Inicio",
				type: "PAGE",
				children: [{ id: "1:2", name: "Frame", type: "FRAME" }],
			},
		});
	});

	it("profundidad 0 no incluye hijos y profundidad 2 baja un nivel más", async () => {
		const { gateway } = await gatewayFor();
		const flat = await gateway.metadata("1:2", 0);
		assert.deepEqual(flat, {
			ok: true,
			value: { id: "1:2", name: "Frame", type: "FRAME" },
		});
		const deep = await gateway.metadata(null, 2);
		assert.ok(deep.ok);
		assert.equal(deep.value.children?.[0]?.children?.[0]?.id, "1:3");
	});
});
