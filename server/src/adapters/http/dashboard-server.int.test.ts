import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { makeActiveChatSessions } from "#application/active-chat-sessions.ts";
import { createActivityFeed } from "#application/activity-feed.ts";
import { makeAgentWatchHub } from "#application/agent-watch-hub.ts";
import { makeSendChat } from "#application/chat-messages.ts";
import { createHistory } from "#application/history.ts";
import { makeDecidePermission } from "#application/permissions.ts";
import {
	makeListSettings,
	makeResetAllSettings,
	makeResetSetting,
	makeSaveSetting,
} from "#application/settings.ts";
import { InMemoryActivitySource } from "#application/testing/in-memory-activity-source.ts";
import { InMemoryAgentLaunches } from "#application/testing/in-memory-agent-launches.ts";
import { noCancelPanel } from "#application/testing/in-memory-cancel.ts";
import {
	InMemoryChatStore,
	InMemoryChatTokens,
} from "#application/testing/in-memory-chat.ts";
import {
	EMPTY_SUMMARY,
	InMemoryHistoryQuery,
} from "#application/testing/in-memory-history-query.ts";
import { InMemoryPermissionStore } from "#application/testing/in-memory-permissions.ts";
import { InMemoryProjectRegistry } from "#application/testing/in-memory-project-registry.ts";
import { InMemorySettings } from "#application/testing/in-memory-settings.ts";
import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	type ActivityEvent,
} from "#domain/activity.ts";
import { ok } from "#domain/result.ts";
import { DASHBOARD_MODE, type SettingView } from "#domain/settings.ts";
import { createDashboardServer } from "./dashboard-server.ts";

const HOST = "127.0.0.1";
const LAUNCHED = {
	launchId: "lanzamiento-1",
	startedAt: "2026-01-01T10:00:00.000Z",
	timeoutMs: 120_000,
};
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

const LIVE_POLL: SettingView = {
	key: "FCC_LIVE_POLL_MS",
	group: "Panel",
	name: "Sondeo en vivo del panel",
	help: "Cada cuánto mira el panel si hay actividad nueva.",
	unit: "ms",
	usedBy: ["panel"],
	stored: "900",
	effective: 900,
	origin: "panel",
	default: 500,
	running: 500,
};
// Los ajustes guardados del panel de prueba: el listado describe solo FCC_LIVE_POLL_MS con lo que haya guardado
const settingsStore = new InMemorySettings({ FCC_LIVE_POLL_MS: "900" });
const settingsKeyProblem = (key: string): string | null =>
	key === "FCC_LIVE_POLL_MS" ? null : `«${key}» no es editable`;
let root: string;
let server: http.Server;
let port: number;
const source = new InMemoryActivitySource();
const historyQuery = new InMemoryHistoryQuery();
const chatStore = new InMemoryChatStore();
const permissionStore = new InMemoryPermissionStore();
const chatTokens = new InMemoryChatTokens();
const CHAT_SESSION = { sessionId: "sesion-chat", token: "token-chat" };
let launches = 0;
// Un lanzamiento vivo del agente, el que vigila la prueba de /api/agent/watch
const WATCHED = "6e9b6885-0000-4000-8000-000000000001";
const agentLaunches = new InMemoryAgentLaunches();
agentLaunches.create(agentLaunches.pathFor(WATCHED), {
	settings: {},
	mcpConfig: {},
	launch: {
		projectId: "1",
		args: [],
		cwd: "/srv/a",
		env: {},
		guard: { repoRoot: "/repo", roots: ["/srv/a"], denied: [] },
		pid: process.pid,
	},
});
// Simula el panel sin ningún proyecto montable (registro vacío)
let withoutProjects = false;

const event = (callId: string): ActivityEvent => ({
	v: ACTIVITY_VERSION,
	at: "2026-01-01T00:00:00.000Z",
	sessionId: "s1",
	type: ACTIVITY_TYPE.toolCalled,
	callId,
	tool: "figma_status",
	args: {},
});

before(async () => {
	root = await mkdtemp(join(tmpdir(), "figma-http-"));
	const web = join(root, "web");
	const shots = join(root, "shots");
	await mkdir(join(web, "fonts"), { recursive: true });
	await mkdir(shots);
	await writeFile(
		join(web, "index.html"),
		"<!doctype html><title>Panel</title>",
	);
	await writeFile(join(web, "app.js"), "console.log(1)");
	await writeFile(join(web, "app.css"), "body{}");
	await writeFile(join(web, "fonts", "m.woff2"), "font");
	await writeFile(join(shots, "ok.png"), PNG);
	await writeFile(join(shots, "nota.txt"), "no soy una captura");
	await writeFile(join(root, "secret.txt"), "secreto");
	await writeFile(join(root, "secret.png"), PNG);
	await symlink(join(root, "secret.png"), join(shots, "enlace.png"));
	const day = join(shots, "capturas", "2026-11-09");
	await mkdir(day, { recursive: true });
	await writeFile(join(day, "6449-7353_213104.png"), PNG);
	await writeFile(join(day, "nota.txt"), "no soy una captura");
	await symlink(join(root, "secret.png"), join(day, "enlace.png"));
	const newDay = join(shots, "screenshots", "2026-11-10");
	await mkdir(newDay, { recursive: true });
	await writeFile(join(newDay, "6449-7353_090000.png"), PNG);
	await writeFile(join(newDay, "nota.txt"), "no soy una captura");

	chatStore.register(CHAT_SESSION);
	permissionStore.register(CHAT_SESSION);
	chatTokens.publish(CHAT_SESSION.sessionId, CHAT_SESSION.token);
	source.seed(event("h1"), event("h2"), event("h3"));
	const feed = createActivityFeed({ source, replayLimit: 10 });
	feed.start();
	server = createDashboardServer({
		forProject: async () =>
			withoutProjects
				? undefined
				: {
						feed,
						history: createHistory({
							query: historyQuery,
							now: () => new Date(),
							maxRows: 50,
						}),
						chat: {
							panel: chatStore,
							sendChat: makeSendChat({ panel: chatStore, tokens: chatTokens }),
							activeSessions: makeActiveChatSessions({
								panel: chatStore,
								tokens: chatTokens,
							}),
							pollMs: 10,
						},
						permissions: {
							panel: permissionStore,
							decide: makeDecidePermission({
								panel: permissionStore,
								tokens: chatTokens,
							}),
						},
						cancel: { panel: noCancelPanel },
						screenshotsDir: shots,
					},
		agent: {
			launch: () => {
				launches++;
				return Promise.resolve(ok(LAUNCHED));
			},
			projectIds: () => Promise.resolve(["1"]),
			watch: makeAgentWatchHub({
				launches: agentLaunches,
				isAlive: (pid) => pid === process.pid,
			}),
		},
		projects: {
			registry: new InMemoryProjectRegistry(),
		},
		settings: {
			mode: DASHBOARD_MODE.development,
			list: makeListSettings({
				store: settingsStore,
				describe: (stored) => [
					{ ...LIVE_POLL, stored: stored["FCC_LIVE_POLL_MS"] ?? null },
				],
				problems: () => [],
			}),
			save: makeSaveSetting({
				store: settingsStore,
				validate: settingsKeyProblem,
				setByEnvironment: () => false,
			}),
			reset: makeResetSetting({
				store: settingsStore,
				checkKey: settingsKeyProblem,
			}),
			resetAll: makeResetAllSettings({
				store: settingsStore,
				editableKeys: ["FCC_LIVE_POLL_MS"],
			}),
		},
		webDir: web,
		keepAliveMs: 60_000,
	});
	await new Promise<void>((r) => server.listen(0, HOST, r));
	port = (server.address() as AddressInfo).port;
});
after(async () => {
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
	await rm(root, { recursive: true, force: true });
});

type Reply = {
	status: number;
	type: string;
	body: Buffer;
	headers: http.IncomingHttpHeaders;
};
const request = (
	path: string,
	method = "GET",
	headers: http.OutgoingHttpHeaders = {},
) =>
	new Promise<Reply>((resolve, reject) => {
		http
			.request({ host: HOST, port, path, method, headers }, (res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						type: String(res.headers["content-type"] ?? ""),
						body: Buffer.concat(chunks),
						headers: res.headers,
					}),
				);
			})
			.on("error", reject)
			.end();
	});

describe("estáticos del panel", () => {
	it("GET / sirve index.html", async () => {
		const r = await request("/");
		assert.equal(r.status, 200);
		assert.match(r.type, /text\/html/);
		assert.match(r.body.toString(), /<title>Panel<\/title>/);
	});

	it("sirve el bundle, el CSS y las fuentes con su tipo", async () => {
		assert.match((await request("/app.js")).type, /javascript/);
		assert.match((await request("/app.css")).type, /text\/css/);
		assert.match((await request("/fonts/m.woff2")).type, /font\/woff2/);
	});

	it("un archivo que no existe es 404", async () => {
		assert.equal((await request("/nada.js")).status, 404);
	});

	it("la query no cambia el archivo servido", async () => {
		assert.equal((await request("/app.css?v=3")).status, 200);
	});

	it("una carpeta no se lista", async () => {
		assert.equal((await request("/fonts")).status, 404);
	});

	it("salir de web/dist con .. (también codificado) es 404", async () => {
		for (const path of [
			"/../secret.txt",
			"/%2e%2e/secret.txt",
			"/..%2fsecret.txt",
			"/fonts/../../secret.txt",
			"//etc/passwd",
			"/%00",
			"/%zz",
		]) {
			assert.equal((await request(path)).status, 404, path);
		}
	});

	it("solo GET y HEAD", async () => {
		assert.equal((await request("/", "POST")).status, 405);
		assert.equal((await request("/", "HEAD")).status, 200);
	});
});

describe("GET /api/settings/list", () => {
	it("devuelve los ajustes de la máquina (valor guardado, efectivo y origen) sin depender de ningún proyecto", async () => {
		const r = await request("/api/settings/list");
		assert.equal(r.status, 200);
		assert.deepEqual(JSON.parse(r.body.toString()), {
			ok: true,
			settings: [LIVE_POLL],
			problems: [],
			mode: DASHBOARD_MODE.development,
		});
	});

	it("es solo de lectura", async () => {
		assert.equal((await request("/api/settings/list", "POST")).status, 405);
	});
});

const postSettings = (
	path: string,
	body: unknown,
	headers: http.OutgoingHttpHeaders = {},
) =>
	new Promise<{ status: number; json: Record<string, unknown> }>(
		(resolve, reject) => {
			const payload = JSON.stringify(body);
			const req = http.request(
				{
					host: HOST,
					port,
					path,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: `http://${HOST}:${port}`,
						"Content-Length": Buffer.byteLength(payload),
						...headers,
					},
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (c: Buffer) => chunks.push(c));
					res.on("end", () =>
						resolve({
							status: res.statusCode ?? 0,
							json: JSON.parse(Buffer.concat(chunks).toString()),
						}),
					);
				},
			);
			req.on("error", reject);
			req.end(payload);
		},
	);

describe("POST /api/settings/save y /reset", () => {
	it("aceptan el Host y el origen reales del panel y responden el listado al día", async () => {
		const saved = await postSettings("/api/settings/save", {
			key: "FCC_LIVE_POLL_MS",
			value: "300",
		});
		assert.equal(saved.status, 200);
		assert.deepEqual(saved.json["settings"], [{ ...LIVE_POLL, stored: "300" }]);
		const reset = await postSettings("/api/settings/reset", {
			key: "FCC_LIVE_POLL_MS",
		});
		assert.equal(reset.status, 200);
		assert.deepEqual(reset.json["settings"], [{ ...LIVE_POLL, stored: null }]);
		settingsStore.set("FCC_LIVE_POLL_MS", "900");
	});

	it("/reset-all acepta el Host y el origen reales, restablece y dice qué", async () => {
		const r = await postSettings("/api/settings/reset-all", {});
		assert.equal(r.status, 200);
		assert.deepEqual(r.json["reset"], ["FCC_LIVE_POLL_MS"]);
		assert.deepEqual(r.json["settings"], [{ ...LIVE_POLL, stored: null }]);
		settingsStore.set("FCC_LIVE_POLL_MS", "900");
	});

	it("rechazan un Host ajeno y un origen ajeno sin escribir", async () => {
		for (const headers of [
			{ Host: "evil.test" },
			{ Origin: "http://evil.test" },
		]) {
			const r = await postSettings(
				"/api/settings/save",
				{ key: "FCC_LIVE_POLL_MS", value: "1" },
				headers,
			);
			assert.equal(r.status, 403, JSON.stringify(headers));
		}
		assert.deepEqual(settingsStore.all(), { FCC_LIVE_POLL_MS: "900" });
	});

	it("con la base ilegible, 500 con el motivo", async () => {
		settingsStore.failWith = new Error("base bloqueada");
		try {
			for (const [path, body] of [
				["/api/settings/save", { key: "FCC_LIVE_POLL_MS", value: "300" }],
				["/api/settings/reset", { key: "FCC_LIVE_POLL_MS" }],
				["/api/settings/reset-all", {}],
			] as const) {
				const r = await postSettings(path, body);
				assert.equal(r.status, 500, path);
				assert.match(JSON.stringify(r.json), /base bloqueada/);
			}
		} finally {
			settingsStore.failWith = null;
		}
	});
});

describe("capturas", () => {
	it("sirve un PNG de la carpeta de salida", async () => {
		const r = await request("/screenshots/ok.png");
		assert.equal(r.status, 200);
		assert.equal(r.type, "image/png");
		assert.deepEqual(new Uint8Array(r.body), PNG);
	});

	it("sirve una captura nueva de screenshots/<fecha>/", async () => {
		const r = await request(
			"/screenshots/screenshots/2026-11-10/6449-7353_090000.png",
		);
		assert.equal(r.status, 200);
		assert.equal(r.type, "image/png");
		assert.deepEqual(new Uint8Array(r.body), PNG);
		assert.equal(
			(await request("/screenshots/screenshots/2026-11-10/nota.txt")).status,
			404,
		);
	});

	it("sigue sirviendo las de la carpeta antigua capturas/<fecha>/", async () => {
		const r = await request(
			"/screenshots/capturas/2026-11-09/6449-7353_213104.png",
		);
		assert.equal(r.status, 200);
		assert.equal(r.type, "image/png");
		assert.deepEqual(new Uint8Array(r.body), PNG);
	});

	it("la subcarpeta por fecha no abre path traversal ni otras subcarpetas", async () => {
		for (const path of [
			"/screenshots/capturas/2026-11-09/../../secret.png",
			"/screenshots/capturas/2026-11-09/%2e%2e%2f%2e%2e%2fsecret.png",
			"/screenshots/capturas/2026-11-09/..%2f..%2f..%2fsecret.png",
			"/screenshots/capturas/2026-11-09/enlace.png",
			"/screenshots/capturas/2026-11-09/nota.txt",
			"/screenshots/capturas/2026-11-09/sub/6449-7353_213104.png",
			"/screenshots/capturas/2026-11-9/6449-7353_213104.png",
			"/screenshots/capturas/otra/6449-7353_213104.png",
			"/screenshots/capturas/6449-7353_213104.png",
			"/screenshots/otra/2026-11-09/6449-7353_213104.png",
			"/screenshots/capturas/2026-11-09/",
			"/screenshots//etc/passwd.png",
		]) {
			assert.equal((await request(path)).status, 404, path);
		}
	});

	it("rechaza lo que no es una captura o sale de la carpeta", async () => {
		for (const path of [
			"/screenshots/nota.txt",
			"/screenshots/../secret.png",
			"/screenshots/%2e%2e%2fsecret.png",
			"/screenshots/enlace.png",
			"/screenshots/nada.png",
			"/screenshots/",
			"/screenshots/sub/ok.png",
		]) {
			assert.equal((await request(path)).status, 404, path);
		}
	});
});

// Lee el flujo SSE hasta que lo recibido cumple la condición
function readSse(
	until: (text: string) => boolean,
	headers: Record<string, string> = {},
) {
	return new Promise<{ text: string; close: () => void }>((resolve, reject) => {
		const req = http.get(
			{ host: HOST, port, path: "/events", headers },
			(res) => {
				let text = "";
				assert.equal(res.statusCode, 200);
				assert.match(String(res.headers["content-type"]), /text\/event-stream/);
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					text += chunk;
					if (until(text)) resolve({ text, close: () => req.destroy() });
				});
			},
		);
		req.on("error", reject);
		setTimeout(
			() => reject(new Error("el SSE no llegó a tiempo")),
			3000,
		).unref();
	});
}

const idsIn = (text: string) =>
	[...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));

describe("GET /events sin ningún proyecto", () => {
	it("sin ?project y sin proyectos el flujo se abre vacío y dice que está listo: el panel está conectado aunque no haya nada que seguir", async () => {
		withoutProjects = true;
		try {
			const { text, close } = await readSse((t) => t.includes("event: ready"));
			close();
			assert.match(text, /event: ready\nid: 0\ndata: \{"latestId":0\}/);
		} finally {
			withoutProjects = false;
		}
	});

	it("un ?project que no existe sigue siendo 404", async () => {
		withoutProjects = true;
		try {
			assert.equal((await request("/events?project=nope")).status, 404);
		} finally {
			withoutProjects = false;
		}
	});
});

describe("GET /events (SSE por id del último evento)", () => {
	it("al conectar dice que está listo, con el id del último evento, y no reenvía historial", async () => {
		const { text, close } = await readSse((t) => t.includes("event: ready"));
		close();
		assert.match(text, /event: ready\nid: 3\ndata: \{"latestId":3\}/);
		assert.doesNotMatch(text, /"callId":"h1"/);
	});

	it("envía los eventos nuevos en cuanto aparecen, cada uno con su id", async () => {
		const live = readSse((t) => t.includes('"callId":"vivo"'));
		await new Promise((r) => setTimeout(r, 50));
		source.emit(event("vivo"));
		const { text, close } = await live;
		close();
		assert.match(text, /\nid: \d+\ndata: \{"v":1[^\n]*"callId":"vivo"/);
	});

	it("con Last-Event-ID reenvía lo que se perdió y después avisa de que está listo", async () => {
		const { text, close } = await readSse((t) => t.includes("event: ready"), {
			"Last-Event-ID": "1",
		});
		close();
		assert.match(text, /"callId":"h2"/);
		assert.match(text, /"callId":"h3"/);
		assert.doesNotMatch(text, /"callId":"h1"/);
		assert.ok(text.indexOf('"callId":"h3"') < text.indexOf("event: ready"));
		assert.deepEqual(idsIn(text).slice(0, 2), [2, 3]);
	});

	it("un Last-Event-ID que no es un número se ignora", async () => {
		const { text, close } = await readSse((t) => t.includes("event: ready"), {
			"Last-Event-ID": "abc",
		});
		close();
		assert.doesNotMatch(text, /"callId"/);
	});

	it("una conexión cerrada no estorba al resto", async () => {
		const first = await readSse((t) => t.includes("event: ready"));
		first.close();
		await new Promise((r) => setTimeout(r, 30));
		const live = readSse((t) => t.includes('"callId":"otro"'));
		await new Promise((r) => setTimeout(r, 50));
		source.emit(event("otro"));
		(await live).close();
	});
});

describe("GET /api/history/*", () => {
	it("sirve JSON del caso de uso, con su tipo y sin caché", async () => {
		historyQuery.summaryReply = { ...EMPTY_SUMMARY, calls: 7 };
		const r = await request("/api/history/summary?preset=last_hour");
		assert.equal(r.status, 200);
		assert.match(r.type, /application\/json/);
		assert.equal(r.headers["cache-control"], "no-store");
		assert.equal(JSON.parse(r.body.toString()).summary.calls, 7);
	});

	it("un error de uso es un 400 con el cuerpo de error, y lo desconocido un 404", async () => {
		const bad = await request("/api/history/summary?since=ayer");
		assert.equal(bad.status, 400);
		assert.equal(JSON.parse(bad.body.toString()).error.type, "InvalidRange");
		assert.equal((await request("/api/history/nada")).status, 404);
	});

	it("el contenido entero de un intento sale como text/plain, con nosniff y sin caché: nunca como HTML", async () => {
		historyQuery.storedScriptReply = {
			kind: "found",
			script: {
				sha256: "h",
				kind: "js",
				bytes: 20,
				stored: "full",
				content: "<script>alert(1)</script>\n",
			},
		};
		const r = await request("/api/history/attempts/3/script/raw?role=step");
		assert.equal(r.status, 200);
		assert.equal(r.type, "text/plain; charset=utf-8");
		assert.equal(r.headers["x-content-type-options"], "nosniff");
		assert.equal(r.headers["cache-control"], "no-store");
		assert.equal(r.body.toString(), "<script>alert(1)</script>\n");
	});

	it("las rutas de intentos con un ?project que no existe: 404 ProjectNotAvailable", async () => {
		withoutProjects = true;
		try {
			for (const path of [
				"/api/history/attempt-targets?project=9",
				"/api/history/attempts?project=9&kind=capture&target=x",
				"/api/history/attempt-diff?project=9&from=1&to=2",
				"/api/history/attempts/1/script/raw?project=9&role=step",
			]) {
				const r = await request(path);
				assert.equal(r.status, 404, path);
				assert.equal(
					JSON.parse(r.body.toString()).error.type,
					"ProjectNotAvailable",
				);
			}
		} finally {
			withoutProjects = false;
		}
	});

	it("las rutas de intentos no admiten POST", async () => {
		assert.equal(
			(await request("/api/history/attempt-diff", "POST")).status,
			405,
		);
	});

	it("solo se puede leer: POST no está permitido", async () => {
		assert.equal((await request("/api/history/summary", "POST")).status, 405);
	});
});

// POST con las cabeceras de una página del propio panel
const postChat = (body: unknown, headers: Record<string, string> = {}) =>
	new Promise<{
		status: number;
		json: {
			ok: boolean;
			message?: { id: number; body: string };
			error?: { type: string };
		};
	}>((resolve, reject) => {
		const payload = JSON.stringify(body);
		const req = http.request(
			{
				host: HOST,
				port,
				path: "/api/chat/messages",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: `http://${HOST}:${port}`,
					"Content-Length": Buffer.byteLength(payload),
					...headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						json: JSON.parse(Buffer.concat(chunks).toString()),
					}),
				);
			},
		);
		req.on("error", reject);
		req.end(payload);
	});

const postAgent = (
	body: string,
	headers: Record<string, string> = {},
	path = "/api/agent/launch?project=1",
) =>
	new Promise<{ status: number; json: { ok: boolean; launchId?: string } }>(
		(resolve, reject) => {
			const req = http.request(
				{
					host: HOST,
					port,
					path,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: `http://${HOST}:${port}`,
						"Content-Length": Buffer.byteLength(body),
						...headers,
					},
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (c: Buffer) => chunks.push(c));
					res.on("end", () =>
						resolve({
							status: res.statusCode ?? 0,
							json: JSON.parse(Buffer.concat(chunks).toString()),
						}),
					);
				},
			);
			req.on("error", reject);
			req.end(body);
		},
	);

describe("/api/agent/launch", () => {
	it("POST sin cuerpo con ?project lanza el agente y responde con el lanzamiento, sin pid", async () => {
		const before = launches;
		const r = await postAgent("");
		assert.equal(r.status, 202);
		assert.deepEqual(r.json, { ok: true, ...LAUNCHED });
		assert.equal(launches, before + 1);
	});

	it("otro Origen, un cuerpo o la query se rechazan sin lanzar nada", async () => {
		const before = launches;
		assert.equal(
			(await postAgent("", { Origin: "https://malo.example" })).status,
			403,
		);
		assert.equal((await postAgent('{"command":"ls"}')).status, 400);
		assert.equal(
			(await postAgent("", {}, "/api/agent/launch?project=1&c=ls")).status,
			400,
		);
		assert.equal((await postAgent("", {}, "/api/agent/launch")).status, 400);
		assert.equal(launches, before);
	});

	it("GET no lanza: es 405", async () => {
		const before = launches;
		assert.equal((await request("/api/agent/launch")).status, 405);
		assert.equal(launches, before);
	});
});

// Abre la vigilancia como agent-run.ts y junta lo que llega por ella hasta que el panel la cierre
function openWatch(path = `/api/agent/watch?launch=${WATCHED}`) {
	const received: Buffer[] = [];
	let status = 0;
	let resolveHeaders: () => void = () => {};
	const headers = new Promise<void>((r) => {
		resolveHeaders = r;
	});
	const ended = new Promise<void>((resolve, reject) => {
		const req = http.request(
			{
				host: HOST,
				port,
				path,
				method: "GET",
				headers: { "Content-Type": "application/json" },
			},
			(res) => {
				status = res.statusCode ?? 0;
				resolveHeaders();
				res.on("data", (c: Buffer) => received.push(c));
				res.on("end", () => resolve());
			},
		);
		req.on("error", reject);
		req.end();
	});
	return {
		headers,
		ended,
		status: () => status,
		text: () => Buffer.concat(received).toString(),
	};
}

describe("/api/agent/watch y /api/agent/close", () => {
	it("la vigilancia queda abierta sin escribir nada y close manda un único evento close por ella", async () => {
		const watch = openWatch();
		await watch.headers;
		assert.equal(watch.status(), 200);
		const listed = await request("/api/agent/launches?project=1");
		assert.deepEqual(JSON.parse(listed.body.toString()), {
			ok: true,
			items: [{ launchId: WATCHED }],
		});
		assert.equal(watch.text(), "");
		const r = await postAgent("", {}, `/api/agent/close?launch=${WATCHED}`);
		assert.equal(r.status, 202);
		await watch.ended;
		assert.equal(watch.text(), "event: close\ndata: {}\n\n");
		const again = await postAgent("", {}, `/api/agent/close?launch=${WATCHED}`);
		assert.equal(again.status, 409);
	});

	it("un lanzamiento desconocido es 404 y la conexión no queda abierta", async () => {
		const watch = openWatch(
			"/api/agent/watch?launch=6e9b6885-0000-4000-8000-00000000ffff",
		);
		await watch.ended;
		assert.equal(watch.status(), 404);
	});

	it("al soltarse la conexión, el lanzamiento deja de listarse", async () => {
		const req = http.request({
			host: HOST,
			port,
			path: `/api/agent/watch?launch=${WATCHED}`,
			method: "GET",
			headers: { "Content-Type": "application/json" },
		});
		const opened = new Promise<void>((r) => req.on("response", () => r()));
		req.on("error", () => {});
		req.end();
		await opened;
		req.destroy();
		let items: unknown[] = [{}];
		for (let i = 0; i < 50 && items.length > 0; i++) {
			await new Promise((r) => setImmediate(r));
			items = JSON.parse(
				(await request("/api/agent/launches?project=1")).body.toString(),
			).items;
		}
		assert.deepEqual(items, []);
	});
});

describe("/api/chat/*", () => {
	it("POST escribe a la sesión y GET lo devuelve; POST no está limitado a GET/HEAD como el resto", async () => {
		const sent = await postChat({
			sessionId: CHAT_SESSION.sessionId,
			text: "hola desde el panel",
		});
		assert.equal(sent.status, 201);
		assert.equal(sent.json.message?.body, "hola desde el panel");
		const listed = await request(
			`/api/chat/messages?session=${CHAT_SESSION.sessionId}`,
		);
		assert.match(listed.body.toString(), /hola desde el panel/);
		assert.equal(
			JSON.parse((await request("/api/chat/sessions")).body.toString()).items[0]
				.sessionId,
			CHAT_SESSION.sessionId,
		);
	});

	it("un POST con otro Origen se rechaza con 403 y no escribe nada", async () => {
		const before = chatStore.all.length;
		const r = await postChat(
			{ sessionId: CHAT_SESSION.sessionId, text: "intruso" },
			{ Origin: "https://malo.example" },
		);
		assert.equal(r.status, 403);
		assert.equal(chatStore.all.length, before);
	});

	it("un cuerpo enorme se corta con 413 sin leerlo entero", async () => {
		const r = await postChat({
			sessionId: CHAT_SESSION.sessionId,
			text: "x".repeat(40_000),
		});
		assert.equal(r.status, 413);
	});

	it("el flujo en vivo envía los mensajes nuevos de esa sesión con su id, y reanuda con Last-Event-ID", async () => {
		const open = (headers: Record<string, string> = {}) =>
			new Promise<{ text: () => string; close: () => void }>(
				(resolve, reject) => {
					let text = "";
					const req = http.get(
						{
							host: HOST,
							port,
							path: `/api/chat/stream?session=${CHAT_SESSION.sessionId}`,
							headers,
						},
						(res) => {
							assert.match(
								String(res.headers["content-type"]),
								/text\/event-stream/,
							);
							res.setEncoding("utf8");
							res.on("data", (c: string) => (text += c));
							resolve({ text: () => text, close: () => req.destroy() });
						},
					);
					req.on("error", reject);
				},
			);
		const waitFor = async (get: () => string, needle: string) => {
			for (let i = 0; i < 200 && !get().includes(needle); i++)
				await new Promise((r) => setTimeout(r, 10));
			assert.ok(get().includes(needle), `no llegó ${needle}: ${get()}`);
		};
		const last = chatStore.all.at(-1)?.id ?? 0;
		const stream = await open({ "Last-Event-ID": String(last) });
		const sent = await postChat({
			sessionId: CHAT_SESSION.sessionId,
			text: "en vivo",
		});
		await waitFor(stream.text, "en vivo");
		assert.match(
			stream.text(),
			new RegExp(`id: ${sent.json.message?.id}\\ndata: \\{`),
		);
		const reply = chatStore.reply(
			{ sessionId: CHAT_SESSION.sessionId, token: CHAT_SESSION.token },
			chatStore.all.at(-1)?.chatId ?? "",
			"respuesta viva",
		);
		assert.ok(reply.ok);
		await waitFor(stream.text, "respuesta viva");
		stream.close();
		const resumed = await open({
			"Last-Event-ID": String((sent.json.message?.id ?? 1) - 1),
		});
		await waitFor(resumed.text, "en vivo");
		resumed.close();
	});
});

describe("/api/chat/permissions", () => {
	const post = (body: unknown, headers: Record<string, string> = {}) =>
		new Promise<{ status: number; body: string }>((resolve, reject) => {
			const payload = JSON.stringify(body);
			const req = http.request(
				{
					host: HOST,
					port,
					path: "/api/chat/permissions",
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: `http://${HOST}:${port}`,
						"Content-Length": Buffer.byteLength(payload),
						...headers,
					},
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (c: Buffer) => chunks.push(c));
					res.on("end", () =>
						resolve({
							status: res.statusCode ?? 0,
							body: Buffer.concat(chunks).toString(),
						}),
					);
				},
			);
			req.on("error", reject);
			req.end(payload);
		});

	it("lista las peticiones de la sesión y se puede contestar una vez, con el origen del propio panel", async () => {
		const saved = permissionStore.record(CHAT_SESSION, {
			requestId: "abcde",
			toolName: "Bash",
			description: "Run shell command",
			inputPreview: "{}",
		});
		assert.ok(saved);
		const listed = JSON.parse(
			(
				await request(`/api/chat/permissions?session=${CHAT_SESSION.sessionId}`)
			).body.toString(),
		);
		assert.equal(listed.items[0].requestId, "abcde");
		const ask = {
			sessionId: CHAT_SESSION.sessionId,
			id: saved.id,
			behavior: "allow",
		};
		assert.equal(
			(await post(ask, { Origin: "https://malo.example" })).status,
			403,
		);
		assert.equal((await post(ask)).status, 200);
		assert.equal((await post(ask)).status, 409);
	});
});

// Solo la cabecera de estado: las rutas SSE no terminan, así que no se espera al cuerpo
const statusOnly = (path: string, headers: http.OutgoingHttpHeaders) =>
	new Promise<number>((resolve, reject) => {
		const req = http.request({ host: HOST, port, path, headers }, (res) => {
			resolve(res.statusCode ?? 0);
			req.destroy();
		});
		req.on("error", (e) => {
			if ((e as NodeJS.ErrnoException).code !== "ECONNRESET") reject(e);
		});
		req.end();
	});

describe("Host en las lecturas (DNS rebinding)", () => {
	const GET_PATHS = [
		"/",
		"/app.js",
		"/events",
		"/api/history/summary",
		"/screenshots/ok.png",
		"/api/projects/list",
		"/api/chat/sessions",
		"/api/chat/stream?session=sesion-chat",
	];

	for (const path of GET_PATHS) {
		it(`GET ${path} con un Host ajeno es 403`, async () => {
			assert.equal(await statusOnly(path, { Host: "evil.example" }), 403);
		});
	}

	it("con el Host del panel las mismas rutas responden", async () => {
		for (const path of ["/", "/api/projects/list", "/screenshots/ok.png"]) {
			assert.equal((await request(path)).status, 200, path);
		}
		const local = await request("/", "GET", { Host: `localhost:${port}` });
		assert.equal(local.status, 200);
	});
});

describe("/api/jobs/cancel", () => {
	it("GET de un job que no existe es 404 con JSON; llega al manejador del tenant", async () => {
		const r = await request("/api/jobs/cancel?job=nada");
		assert.equal(r.status, 404);
		assert.equal(
			(JSON.parse(r.body.toString()) as { error: { type: string } }).error.type,
			"NoSuchJob",
		);
	});

	it("POST con un Host que no es el del panel se rechaza", async () => {
		const r = await request("/api/jobs/cancel", "POST", {
			Host: "evil.example",
			"Content-Type": "application/json",
		});
		assert.equal(r.status, 403);
	});
});
