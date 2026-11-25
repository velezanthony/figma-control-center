import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { startFakeCdp } from "#adapters/cdp/testing/fake-cdp-server.ts";
import type { MachineConfig, TenantConfig } from "#domain/config.ts";
import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";
import { DASHBOARD_MODE } from "#domain/settings.ts";
import { createTenant } from "./compose-tenant.ts";

// MachineConfig de prueba (valores cualesquiera: createTenant no conecta, solo cablea)
const machine = (dbPath: string): MachineConfig => ({
	cdp: { host: "127.0.0.1", port: 9222, callTimeoutMs: 1000 },
	chrome: { profile: "/p", seedProfile: null },
	figma: { testFileUrl: null, readyTimeoutMs: 1000 },
	scriptsBaseDir: "/repo",
	output: { maxInlineResultBytes: 1000 },
	jobs: { softDeadlineMs: 1000 },
	activity: { codePreviewChars: 100 },
	dashboard: {
		host: "127.0.0.1",
		port: 4173,
		historyEvents: 100,
		mode: DASHBOARD_MODE.production,
	},
	history: {
		retentionDays: 90,
		maxRows: 50,
		stepExcerptBytes: 300,
		scriptMaxBytes: 2_000_000,
		diffInlineLines: 200,
	},
	live: { pollMs: 500 },
	chat: { pollMs: 700, agent: false },
	agent: {
		terminal: ["x"],
		launchTimeoutMs: 1000,
		panelGraceMs: 1000,
		watchRetryMs: 100,
		claudeBin: null,
		testHarness: true,
	},
	build: {
		maxSteps: 10,
		stepTimeoutMs: 1000,
		progressMinIntervalMs: 500,
		maxParamsBytes: 1000,
		maxAssetBytes: 1000,
	},
	read: { exportMaxNodes: 20, designContextMaxNodes: 400 },
	e2e: { enabled: false },
	web: {
		chromeBin: "chrome",
		chromePort: 9333,
		profileDir: "/tmp",
		secretsFile: "/tmp/secretos.json",
		pageTimeoutMs: 1000,
		captureMaxBytes: 1000,
		contractInlineErrors: 10,
	},
	locksDir: "/tmp/locks",
	dbPath,
});

describe("createTenant: ninguna herramienta espera a la pestaña más que el plazo blando", () => {
	it("con FIGMA_READY_TIMEOUT_MS mayor que el plazo blando, una pestaña cargando da loading al vencer el plazo blando (CA-7)", async () => {
		const fake = await startFakeCdp();
		const dir = await mkdtemp(join(tmpdir(), "fcc-tenant-"));
		try {
			const base = machine(join(dir, "figma.db"));
			const t = createTenant(
				{
					...base,
					cdp: { ...base.cdp, port: fake.port },
					figma: { ...base.figma, readyTimeoutMs: 30_000 },
					jobs: { softDeadlineMs: 300 },
				},
				{
					id: "7",
					name: "Ejemplo",
					fileUrl: "https://www.figma.com/design/KEY/Nombre",
					scriptsRoots: [dir],
					outputDir: dir,
					projectDir: "/proyecto",
					activityFile: join(dir, "activity.jsonl"),
				},
			);
			const started = performance.now();
			const r = await t.client.evaluate("1");
			assert.ok(!r.ok);
			assert.equal(r.error.type, FIGMA_ERROR_TYPE.figmaNotReady);
			assert.ok(performance.now() - started < 2000);
			t.client.close();
		} finally {
			await fake.close();
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("createTenant (integración)", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "fcc-tenant-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("monta el plano de datos del tenant sobre la base única, con su número de proyecto", async () => {
		const tenant: TenantConfig = {
			id: "7",
			name: "Ejemplo",
			fileUrl: "https://www.figma.com/design/abc/Ejemplo",
			scriptsRoots: [dir],
			outputDir: dir,
			projectDir: "/proyecto",
			activityFile: join(dir, "activity.jsonl"),
		};
		const base = join(dir, "figma.db");
		const t = createTenant(machine(base), tenant);
		assert.equal(t.config.id, "7");
		assert.ok(t.gateway);
		assert.ok(t.scripts);
		assert.ok(t.jobs);
		// La base única queda creada donde dice la configuración de máquina
		assert.ok((await stat(base)).isFile());
	});

	it("un tenant cuyo id no es un número de proyecto no se monta: es un bug, no un proyecto", () => {
		assert.throws(
			() =>
				createTenant(machine(join(dir, "figma.db")), {
					id: "ejemplo",
					name: "Ejemplo",
					fileUrl: "https://www.figma.com/design/abc/Ejemplo",
					scriptsRoots: [dir],
					outputDir: dir,
					projectDir: "/proyecto",
					activityFile: join(dir, "activity.jsonl"),
				}),
			/id de proyecto/,
		);
	});
});
