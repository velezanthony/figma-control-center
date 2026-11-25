import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { build } from "vite";
import { createDashboardServer } from "#adapters/http/dashboard-server.ts";
import { makeActiveChatSessions } from "#application/active-chat-sessions.ts";
import { createActivityFeed } from "#application/activity-feed.ts";
import { makeAgentWatchHub } from "#application/agent-watch-hub.ts";
import { makeSendChat } from "#application/chat-messages.ts";
import { createHistory } from "#application/history.ts";
import { makeDecidePermission } from "#application/permissions.ts";
import { InMemoryActivitySource } from "#application/testing/in-memory-activity-source.ts";
import { InMemoryAgentLaunches } from "#application/testing/in-memory-agent-launches.ts";
import { noCancelPanel } from "#application/testing/in-memory-cancel.ts";
import {
	InMemoryChatStore,
	InMemoryChatTokens,
} from "#application/testing/in-memory-chat.ts";
import { InMemoryHistoryQuery } from "#application/testing/in-memory-history-query.ts";
import { InMemoryPermissionStore } from "#application/testing/in-memory-permissions.ts";
import { InMemoryProjectRegistry } from "#application/testing/in-memory-project-registry.ts";
import { err, ok } from "#domain/result.ts";
import { DASHBOARD_MODE } from "#domain/settings.ts";

const HOST = "127.0.0.1";
const VITE_CONFIG = join(import.meta.dirname, "../../web/vite.config.ts");
const MIN_BUNDLE_BYTES = 10_000;

const chatStore = new InMemoryChatStore();
const permissionStore = new InMemoryPermissionStore();
const chatTokens = new InMemoryChatTokens();
let dist: string;
let server: Server;
let base: string;

before(async () => {
	dist = await mkdtemp(join(tmpdir(), "figma-web-"));
	await build({
		configFile: VITE_CONFIG,
		logLevel: "silent",
		build: { outDir: dist },
	});
	const feed = createActivityFeed({
		source: new InMemoryActivitySource(),
		replayLimit: 10,
	});
	feed.start();
	server = createDashboardServer({
		forProject: async () => ({
			feed,
			history: createHistory({
				query: new InMemoryHistoryQuery(),
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
				pollMs: 1000,
			},
			permissions: {
				panel: permissionStore,
				decide: makeDecidePermission({
					panel: permissionStore,
					tokens: chatTokens,
				}),
			},
			cancel: { panel: noCancelPanel },
			screenshotsDir: dist,
		}),
		agent: {
			launch: () =>
				Promise.resolve(err({ type: "LaunchFailed", message: "no se lanza" })),
			projectIds: () => Promise.resolve(["default"]),
			watch: makeAgentWatchHub({
				launches: new InMemoryAgentLaunches(),
				isAlive: () => false,
			}),
		},
		projects: {
			registry: new InMemoryProjectRegistry(),
		},
		settings: {
			mode: DASHBOARD_MODE.production,
			list: () => ok({ settings: [], problems: [] }),
			save: () => ok(undefined),
			reset: () => ok(undefined),
			resetAll: () => ok([]),
		},
		webDir: dist,
	});
	await new Promise<void>((r) => server.listen(0, HOST, r));
	base = `http://${HOST}:${(server.address() as AddressInfo).port}`;
});

after(async () => {
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
	await rm(dist, { recursive: true, force: true });
});

describe("humo del panel compilado de verdad", () => {
	it("GET / sirve la página que enlaza el CSS y el bundle", async () => {
		const res = await fetch(`${base}/`);
		const html = await res.text();
		assert.equal(res.status, 200);
		assert.match(html, /href="\/app\.css"/);
		assert.match(html, /src="\/app\.js"/);
		assert.match(html, /<div id="app">/);
	});

	it("el bundle y el CSS se sirven con su tipo y no están vacíos", async () => {
		const js = await fetch(`${base}/app.js`);
		assert.match(js.headers.get("content-type") ?? "", /javascript/);
		assert.ok((await js.text()).length > MIN_BUNDLE_BYTES);
		const css = await fetch(`${base}/app.css`);
		assert.match(css.headers.get("content-type") ?? "", /text\/css/);
		const text = await css.text();
		assert.match(text, /--brand-500/);
		assert.match(text, /data-theme=.?light/);
	});

	it("el script del tema está disponible", async () => {
		assert.equal((await fetch(`${base}/theme-init.js`)).status, 200);
	});

	it("el panel no pide nada a un CDN: ninguna carga externa en el HTML ni en el CSS", async () => {
		const html = await (await fetch(`${base}/`)).text();
		const css = await (await fetch(`${base}/app.css`)).text();
		assert.doesNotMatch(html, /(?:src|href)=["']https?:/);
		assert.doesNotMatch(
			css,
			/url\(["']?https?:|@import\s+["']?(?:url\()?["']?https?:/,
		);
	});
});
