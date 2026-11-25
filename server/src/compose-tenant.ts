// Composición por tenant. Monta el PLANO DE DATOS de un proyecto:
// adaptadores + base, ya cableados. El servidor MCP, la sesión y el chat los monta main.ts encima
// (las bandejas de chat deben instanciarse en main.ts; dashboard.ts NO importa esto: alcanzaría cdp/mcp).
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CdpClient } from "#adapters/cdp/cdp-client.ts";
import { CdpFigmaGateway } from "#adapters/cdp/cdp-figma-gateway.ts";
import { CdpFigmaReader } from "#adapters/cdp/cdp-figma-reader.ts";
import { FsAssetRepository } from "#adapters/fs/fs-asset-repository.ts";
import { FsBuildManifest } from "#adapters/fs/fs-build-manifest.ts";
import { createFsOpenLock } from "#adapters/fs/fs-open-lock.ts";
import { FsResultStore } from "#adapters/fs/fs-result-store.ts";
import { FsScriptRepository } from "#adapters/fs/fs-script-repository.ts";
import {
	SCREEN_PLANS_DIR,
	SHEET_PLANS_DIR,
	WEB_CAPTURES_DIR,
} from "#adapters/fs/fs-web-capture-store.ts";
import { isProcessAlive } from "#adapters/process/is-process-alive.ts";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteActivityLog } from "#adapters/sqlite/sqlite-activity-log.ts";
import { SqliteHistoryQuery } from "#adapters/sqlite/sqlite-history-query.ts";
import { createHistory } from "#application/history.ts";
import {
	type BuildLock,
	createJobRegistry,
	localBuildLock,
} from "#application/job-registry.ts";
import type { HistoryQuery } from "#application/ports/history-query.ts";
import type { MachineConfig, TenantConfig } from "#domain/config.ts";
import { toJobId } from "#domain/job.ts";
import { toProjectNumber } from "#domain/registry.ts";

// Cada cuánto reintenta quien espera a que otra sesión termine de abrir la pestaña
const OPEN_LOCK_POLL_MS = 50;

export type Tenant = {
	readonly config: TenantConfig;
	readonly client: CdpClient;
	readonly gateway: CdpFigmaGateway;
	readonly reader: CdpFigmaReader;
	readonly scripts: FsScriptRepository;
	readonly assets: FsAssetRepository;
	readonly store: FsResultStore;
	readonly jobs: ReturnType<typeof createJobRegistry>;
	readonly buildManifest: FsBuildManifest;
	readonly historyLog: SqliteActivityLog;
	readonly historyQueries: ReturnType<typeof createHistory>;
	// La consulta cruda del histórico (solo lectura): para lo que necesita los resultados enteros de los pasos
	readonly historyQuery: HistoryQuery;
};

export function createTenant(
	machine: MachineConfig,
	tenant: TenantConfig,
	// Lock de lote por pestaña (MP-6): main.ts pasa el de este fileUrl; por defecto, local al tenant
	buildLock: BuildLock = localBuildLock(),
): Tenant {
	const client = new CdpClient({
		host: machine.cdp.host,
		port: machine.cdp.port,
		fileUrl: tenant.fileUrl,
		callTimeoutMs: machine.cdp.callTimeoutMs,
		// Ninguna herramienta espera a la pestaña más que el plazo blando: pasado, FigmaNotReady `loading` (no un job)
		readyTimeoutMs: Math.min(
			machine.figma.readyTimeoutMs,
			machine.jobs.softDeadlineMs,
		),
		// Sin la pestaña del proyecto, el servidor la abre (D-2 B), una sola aunque haya varias sesiones a la vez
		openTab: createFsOpenLock({
			dir: machine.locksDir,
			pid: process.pid,
			isAlive: isProcessAlive,
			pollMs: OPEN_LOCK_POLL_MS,
			timeoutMs: machine.jobs.softDeadlineMs,
		}),
	});
	// Las raíces de scripts son del tenant; la base contra la que se resuelven las rutas relativas, de máquina
	const scriptOptions = {
		roots: tenant.scriptsRoots,
		baseDir: machine.scriptsBaseDir,
	};
	const projectId = toProjectNumber(tenant.id);
	const historyQuery = new SqliteHistoryQuery({
		projectId,
		db: openFigmaDatabase(machine.dbPath, { queryOnly: true }),
	});
	return {
		config: tenant,
		client,
		gateway: new CdpFigmaGateway(client),
		reader: new CdpFigmaReader(client),
		scripts: new FsScriptRepository(scriptOptions),
		// Los assets salen de las raíces de scripts y, para `kit/build-screen@1` y `kit/build-component@1`, del plan y las
		// imágenes de la captura que el propio servidor guardó en la carpeta de salida (solo esas subcarpetas, no toda la salida)
		assets: new FsAssetRepository({
			...scriptOptions,
			roots: [
				...tenant.scriptsRoots,
				join(tenant.outputDir, WEB_CAPTURES_DIR),
				join(tenant.outputDir, SCREEN_PLANS_DIR),
				join(tenant.outputDir, SHEET_PLANS_DIR),
			],
			maxTotalBytes: machine.build.maxAssetBytes,
		}),
		store: new FsResultStore(tenant.outputDir),
		jobs: createJobRegistry(() => toJobId(randomUUID()), buildLock),
		buildManifest: new FsBuildManifest({
			...scriptOptions,
			maxSteps: machine.build.maxSteps,
		}),
		historyLog: new SqliteActivityLog({
			projectId,
			db: openFigmaDatabase(machine.dbPath),
			warn: (message) => console.error(message),
		}),
		historyQuery,
		historyQueries: createHistory({
			query: historyQuery,
			now: () => new Date(),
			maxRows: machine.history.maxRows,
			stepExcerptBytes: machine.history.stepExcerptBytes,
		}),
	};
}
