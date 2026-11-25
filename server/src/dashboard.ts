// Segunda raíz de composición: el panel de actividad multi-tenant. Lee las bases que escribe el servidor MCP
// (una por proyecto; nunca habla con Figma) y puede escribir en stdout: es otro proceso, no el canal MCP.
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	bootLayered,
	describeStored,
	layeredWith,
	problemsOfStored,
	setByPanelEnvironment,
} from "#adapters/config/env.ts";
import {
	EDITABLE_KEYS,
	editableKeyProblem,
	FILE_URL_IGNORED_WARNING,
	isSettingDefault,
	normalizeSetting,
	REPO_ROOT,
	validateSetting,
} from "#adapters/config/schema.ts";
import { FsAgentLaunches } from "#adapters/fs/fs-agent-launch.ts";
import { FsChatTokens } from "#adapters/fs/fs-chat-tokens.ts";
import { JsonlActivityArchive } from "#adapters/fs/jsonl-activity-archive.ts";
import {
	createDashboardServer,
	type PanelTenant,
} from "#adapters/http/dashboard-server.ts";
import { isProcessAlive } from "#adapters/process/is-process-alive.ts";
import { NodeProcessSpawner } from "#adapters/process/node-process-spawner.ts";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteActivityLog } from "#adapters/sqlite/sqlite-activity-log.ts";
import { SqliteActivitySource } from "#adapters/sqlite/sqlite-activity-source.ts";
import { SqliteCancelPanel } from "#adapters/sqlite/sqlite-cancel-requests.ts";
import { SqliteChatPanel } from "#adapters/sqlite/sqlite-chat.ts";
import { SqliteHistoryQuery } from "#adapters/sqlite/sqlite-history-query.ts";
import { SqlitePermissionPanel } from "#adapters/sqlite/sqlite-permissions.ts";
import { makeActiveChatSessions } from "#application/active-chat-sessions.ts";
import { createActivityFeed } from "#application/activity-feed.ts";
import { makeAgentWatchHub } from "#application/agent-watch-hub.ts";
import { makeSendChat } from "#application/chat-messages.ts";
import { createHistory } from "#application/history.ts";
import { makeImportActivity } from "#application/import-activity.ts";
import { makeLaunchAgent } from "#application/launch-agent.ts";
import { makeMaintainHistory } from "#application/maintain-history.ts";
import { makePanelTenants } from "#application/panel-tenants.ts";
import { makeDecidePermission } from "#application/permissions.ts";
import { makePrepareAgentLaunch } from "#application/prepare-agent-launch.ts";
import { makePruneHistory } from "#application/prune-history.ts";
import { resolveTenants } from "#application/resolve-tenants.ts";
import {
	makeListSettings,
	makeResetAllSettings,
	makeResetSetting,
	makeSaveSetting,
} from "#application/settings.ts";
import type { TenantConfig } from "#domain/config.ts";
import { toProjectNumber } from "#domain/registry.ts";
import { openRegistry } from "./compose-registry.ts";
import { composeConfig } from "./compose-settings.ts";

const WEB_DIST_DIR = "web/dist";
const FATAL_EXIT_CODE = 1;
// Subcarpeta de outputDir con los tokens del chat (valor fijo del programa)
const CHAT_TOKENS_DIR = "chat-tokens";

const fatal = (reason: unknown): never => {
	console.error("figma-control-center-dashboard: fallo fatal:", reason);
	process.exit(FATAL_EXIT_CODE);
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

// default < base (ajustes del panel) < entorno: la configuración final se compone una vez, con la base ya abierta
const {
	layered,
	store: settingsStore,
	storedAtBoot,
} = composeConfig({
	boot: bootLayered,
	layeredWith,
	warn: (message) => console.error(message),
});

if (layered.fileUrlIgnored) {
	console.error(`figma-control-center-dashboard: ${FILE_URL_IGNORED_WARNING}`);
}

// Proyectos que sirve el panel: los del registro, dentro del alcance. Sin ?project, el primero
const registry = openRegistry({
	dbPath: layered.machine.dbPath,
	outputRoot: layered.outputRoot,
	outputDirFor: layered.outputDirFor,
});
const resolvedTenants = await resolveTenants({
	registry,
	scope: layered.scope,
	resolveEntry: layered.resolveEntry,
});
const tenantConfigs = resolvedTenants.tenants;

// Los avisos del registro se escriben una vez por cambio, no en cada petición
let lastProblems = "";
function warnRegistry(problems: readonly string[]): void {
	const text = problems.join("\n");
	if (text === lastProblems) return;
	lastProblems = text;
	for (const problem of problems) {
		console.error(
			`figma-control-center-dashboard: registro de proyectos: ${problem}`,
		);
	}
}
warnRegistry(resolvedTenants.problems);

// El panel lee con conexiones de solo consulta y escribe en el chat con una propia. Las bandejas de chat
// se instancian AQUÍ (un lado del chat por raíz de composición, lo vigila architecture.test.ts).
function buildPanelTenant(t: TenantConfig): PanelTenant {
	const projectId = toProjectNumber(t.id);
	const dbPath = layered.machine.dbPath;
	const chatTokens = new FsChatTokens({
		dir: join(t.outputDir, CHAT_TOKENS_DIR),
	});
	const chatPanel = new SqliteChatPanel({
		projectId,
		db: openFigmaDatabase(dbPath),
	});
	const permissionPanel = new SqlitePermissionPanel({
		projectId,
		db: openFigmaDatabase(dbPath),
	});
	const activeSessions = makeActiveChatSessions({
		panel: chatPanel,
		tokens: chatTokens,
	});
	return {
		feed: createActivityFeed({
			source: new SqliteActivitySource({
				projectId,
				db: openFigmaDatabase(dbPath, { queryOnly: true }),
				pollMs: layered.machine.live.pollMs,
			}),
			replayLimit: layered.machine.dashboard.historyEvents,
		}),
		history: createHistory({
			query: new SqliteHistoryQuery({
				projectId,
				db: openFigmaDatabase(dbPath, { queryOnly: true }),
			}),
			now: () => new Date(),
			maxRows: layered.machine.history.maxRows,
			stepExcerptBytes: layered.machine.history.stepExcerptBytes,
		}),
		chat: {
			panel: chatPanel,
			sendChat: makeSendChat({ panel: chatPanel, tokens: chatTokens }),
			activeSessions,
			pollMs: layered.machine.live.pollMs,
		},
		permissions: {
			panel: permissionPanel,
			decide: makeDecidePermission({
				panel: permissionPanel,
				tokens: chatTokens,
			}),
		},
		cancel: {
			panel: new SqliteCancelPanel({
				projectId,
				db: openFigmaDatabase(dbPath),
			}),
		},
		screenshotsDir: t.outputDir,
	};
}

// Mantenimiento al montar un proyecto: importar el jsonl antiguo (una vez) y podar, cada uno en lo suyo
function maintain(t: TenantConfig): Promise<void> {
	const maintenance = new SqliteActivityLog({
		projectId: toProjectNumber(t.id),
		db: openFigmaDatabase(layered.machine.dbPath),
		warn: (message) => console.error(message),
	});
	return makeMaintainHistory({
		importActivity: makeImportActivity({
			archive: new JsonlActivityArchive({ file: t.activityFile }),
			maintenance,
			key: t.activityFile,
		}),
		pruneHistory: makePruneHistory({
			maintenance,
			retentionDays: layered.machine.history.retentionDays,
			now: () => new Date(),
		}),
		warn: (message) => console.error(message),
	})();
}

// Los proyectos se resuelven al pedirlos (un alta o un borrado en «Proyectos» se nota sin reiniciar el panel);
// el primer acceso a cada uno monta su plano de datos y arranca su feed
const mounted = new Set<PanelTenant>();
const currentTenants = async () => {
	const current = await resolveTenants({
		registry,
		scope: layered.scope,
		resolveEntry: layered.resolveEntry,
	});
	warnRegistry(current.problems);
	return current.tenants;
};
const forProject = makePanelTenants<PanelTenant>({
	resolve: currentTenants,
	build: async (t) => {
		await maintain(t);
		const bundle = buildPanelTenant(t);
		bundle.feed.start();
		mounted.add(bundle);
		return bundle;
	},
	dispose: (bundle) => {
		bundle.feed.stop();
		mounted.delete(bundle);
	},
});

// Los proyectos del arranque se montan ya (el feed empieza a leer y un fallo de base se ve al arrancar)
await Promise.all(tenantConfigs.map((t) => forProject(t.id)));

// Carpetas de lanzamiento del agente: en la carpeta temporal, fuera de toda raíz y del repo. Al arrancar se barren
// las de lanzamientos cuyo vigilante (el panel anterior o un agent-run.ts) ya no vive
const agentLaunches = new FsAgentLaunches({ parent: tmpdir() });
agentLaunches.sweep(isProcessAlive);
const prepareAgentLaunch = makePrepareAgentLaunch({
	registry,
	resolveEntry: layered.resolveEntry,
	realpath: (p) => realpath(p).catch(() => null),
	launches: agentLaunches,
	machine: {
		repoRoot: REPO_ROOT,
		home: homedir(),
		nodeBin: process.execPath,
		outputRoot: layered.outputRoot,
		dbPath: layered.machine.dbPath,
		secretsFile: layered.machine.web.secretsFile,
		defaultScriptsRoots: layered.defaultScriptsRoots,
	},
	pid: process.pid,
});

const server = createDashboardServer({
	// ?project=id → su proyecto; sin id, el proyecto por defecto; id desconocido, undefined
	forProject,
	agent: {
		launch: makeLaunchAgent({
			spawner: new NodeProcessSpawner(),
			terminal: layered.machine.agent.terminal,
			cwd: REPO_ROOT,
			activeSessionIds: () =>
				[...mounted].flatMap((bundle) =>
					bundle.chat.activeSessions().map((s) => s.sessionId),
				),
			now: () => Date.now(),
			timeoutMs: layered.machine.agent.launchTimeoutMs,
			newId: () => randomUUID(),
			prepare: prepareAgentLaunch,
			launches: agentLaunches,
			isAlive: isProcessAlive,
		}),
		projectIds: async () => (await currentTenants()).map((t) => t.id),
		// El panel reconoce un lanzamiento por su carpeta en disco y su pid vivo: tras reiniciarlo, el agente reconecta
		watch: makeAgentWatchHub({
			launches: agentLaunches,
			isAlive: isProcessAlive,
		}),
	},
	projects: { registry },
	settings: {
		mode: layered.machine.dashboard.mode,
		list: makeListSettings({
			store: settingsStore,
			describe: (stored) => describeStored(stored, storedAtBoot),
			problems: problemsOfStored,
		}),
		save: makeSaveSetting({
			store: settingsStore,
			validate: validateSetting,
			normalize: normalizeSetting,
			isDefault: isSettingDefault,
			setByEnvironment: setByPanelEnvironment,
		}),
		reset: makeResetSetting({
			store: settingsStore,
			checkKey: editableKeyProblem,
		}),
		resetAll: makeResetAllSettings({
			store: settingsStore,
			editableKeys: EDITABLE_KEYS,
		}),
	},
	webDir: resolve(REPO_ROOT, WEB_DIST_DIR),
});

const shutdown = () => {
	for (const bundle of mounted) bundle.feed.stop();
	server.closeAllConnections();
	server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.once("error", fatal);
server.listen(
	layered.machine.dashboard.port,
	layered.machine.dashboard.host,
	() => {
		console.log(
			`Panel de actividad en http://${layered.machine.dashboard.host}:${layered.machine.dashboard.port} (${mounted.size} proyecto(s))`,
		);
	},
);
