// Composición de la SESIÓN de un proyecto: lo que cuelga del plano de datos (createTenant) y vive mientras el
// proyecto está servido: caso de uso, recorder, bandejas del chat y de las cancelaciones, sondeos y limpieza.
// main.ts la monta cuando aparece el proyecto vigente y la suelta cuando desaparece (application/active-project.ts).
// stdout es el canal MCP: nada de aquí escribe en él.
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFigmaKitBundle } from "#adapters/cdp/figma-kit.ts";
import { captureSchemaIssues } from "#adapters/contracts/capture.ts";
import { stepResultIssues } from "#adapters/contracts/step.ts";
import type { createFsTabLocks } from "#adapters/fs/fs-build-lock.ts";
import { FsChatTokens } from "#adapters/fs/fs-chat-tokens.ts";
import { FsComposeStore } from "#adapters/fs/fs-compose-store.ts";
import { FsProjectConfig } from "#adapters/fs/fs-project-config.ts";
import { FsSecretStore } from "#adapters/fs/fs-secrets.ts";
import { FsWebCaptureStore } from "#adapters/fs/fs-web-capture-store.ts";
import { JsonlActivityArchive } from "#adapters/fs/jsonl-activity-archive.ts";
import type { BuildProgressBus } from "#adapters/mcp/build-progress.ts";
import {
	pushPermissionVerdict,
	pushToChannel,
	startChatPolling,
} from "#adapters/mcp/channel.ts";
import { systemTimeZone, toLocalIso } from "#adapters/mcp/local-time.ts";
import type { UseCases } from "#adapters/mcp/tools.ts";
import { isProcessAlive } from "#adapters/process/is-process-alive.ts";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteAttemptLog } from "#adapters/sqlite/sqlite-attempt-log.ts";
import { SqliteCancelMailbox } from "#adapters/sqlite/sqlite-cancel-requests.ts";
import { SqliteChatMailbox } from "#adapters/sqlite/sqlite-chat.ts";
import { SqlitePermissionMailbox } from "#adapters/sqlite/sqlite-permissions.ts";
import { readCaptureKitBundle } from "#adapters/web/capture-kit-bundle.ts";
import { ChromeWebCapturer } from "#adapters/web/chrome-web-capturer.ts";
import { CAPTURE_LOCK_NAME } from "#adapters/web/protocol.ts";
import { makeAreaPlan } from "#application/area-plan.ts";
import { makeCancelJob } from "#application/cancel-job.ts";
import { makeHandleCancelRequests } from "#application/cancel-requests.ts";
import { makeCaptureScreens } from "#application/capture-screens.ts";
import { makeReplyChat } from "#application/chat-messages.ts";
import { createChatRelay } from "#application/chat-relay.ts";
import { makeComposePlan } from "#application/compose-plan.ts";
import { makeExportNodes } from "#application/export-nodes.ts";
import { makeGetJob } from "#application/get-job.ts";
import { makeGetMetadata } from "#application/get-metadata.ts";
import { makeGetStatus } from "#application/get-status.ts";
import type { History } from "#application/history.ts";
import { makeHistoryDiff } from "#application/history-diff.ts";
import { makeHistoryScript } from "#application/history-script.ts";
import { makeImportActivity } from "#application/import-activity.ts";
import {
	makeInterruptOwnJobs,
	makeSweepDeadSessionJobs,
} from "#application/interrupt-jobs.ts";
import { makeLastScreenMatches } from "#application/last-screen-matches.ts";
import { makeMaintainHistory } from "#application/maintain-history.ts";
import {
	createPermissionRelay,
	makeRecordPermission,
} from "#application/permissions.ts";
import { makePruneHistory } from "#application/prune-history.ts";
import { makeReadComponents } from "#application/read-components.ts";
import { makeReadDesignContext } from "#application/read-design-context.ts";
import { makeReadInstances } from "#application/read-instances.ts";
import { makeReadStyles } from "#application/read-styles.ts";
import { makeReadVariables } from "#application/read-variables.ts";
import {
	type ActivityRecorder,
	createActivityRecorder,
} from "#application/record-activity.ts";
import { makeAttemptRecorder } from "#application/record-attempt.ts";
import { makeRunBuild } from "#application/run-build.ts";
import { makeRunRead } from "#application/run-read.ts";
import { makeRunScript } from "#application/run-script.ts";
import { makeScreenPlan } from "#application/screen-plan.ts";
import { makeSheetPlan } from "#application/sheet-plan.ts";
import { makeSheetsPlan } from "#application/sheets-plan.ts";
import { makeTakeScreenshot } from "#application/take-screenshot.ts";
import type { MachineConfig, TenantConfig } from "#domain/config.ts";
import { figmaFileKey } from "#domain/figma-url.ts";
import { toProjectNumber } from "#domain/registry.ts";
import { createTenant, type Tenant } from "./compose-tenant.ts";

// Subcarpeta de outputDir con los tokens del chat (valor fijo del programa)
const CHAT_TOKENS_DIR = "chat-tokens";

export type Session = {
	readonly tenant: Tenant;
	readonly useCases: UseCases;
	readonly recorder: ActivityRecorder;
	readonly history: History;
	readonly replyChat: ReturnType<typeof makeReplyChat>;
	readonly recordPermission: ReturnType<typeof makeRecordPermission>;
	// Suelta todo lo que la sesión tenía vivo (sondeos, token del chat, jobs en curso, conexión CDP)
	dispose(): void;
};

export type SessionDeps = {
	readonly machine: MachineConfig;
	readonly sessionId: string;
	readonly tabLocks: ReturnType<typeof createFsTabLocks>;
	readonly progress: BuildProgressBus;
	// El servidor MCP ya creado: el chat del agente le empuja las notificaciones
	readonly server: Parameters<typeof pushToChannel>[0];
	readonly warn: (message: string) => void;
};

export async function mountSession(
	deps: SessionDeps,
	config: TenantConfig,
): Promise<Session> {
	const { machine, sessionId, warn } = deps;
	const tenant = createTenant(
		machine,
		config,
		deps.tabLocks.forUrl(config.fileUrl),
	);

	// Cada servidor MCP (uno por sesión de Claude Code) es una sesión distinta de la base del tenant
	const recorder = createActivityRecorder({
		log: tenant.historyLog,
		sessionId,
		codePreviewChars: machine.activity.codePreviewChars,
		now: () => new Date(),
		elapsedMs: () => performance.now(),
		newCallId: randomUUID,
		warn,
	});

	// Historial de intentos: cada script que corre guarda su contenido exacto. Los kits se leen una vez
	let figmaKit: ReturnType<typeof readFigmaKitBundle> | undefined;
	let captureKit: ReturnType<typeof readCaptureKitBundle> | undefined;
	const attempts = makeAttemptRecorder({
		log: new SqliteAttemptLog({
			projectId: toProjectNumber(config.id),
			db: openFigmaDatabase(machine.dbPath),
			warn,
			maxScriptBytes: () => machine.history.scriptMaxBytes,
		}),
		scripts: tenant.scripts,
		assets: tenant.assets,
		clock: () => new Date(),
		kits: {
			figma: () => {
				figmaKit ??= readFigmaKitBundle();
				return { version: figmaKit.version, content: figmaKit.source };
			},
			capture: () => {
				captureKit ??= readCaptureKitBundle();
				return captureKit;
			},
		},
		warn,
	});

	// Chat con el panel: la sesión firma con un token que solo ella y el panel (por archivo, no por la web) conocen
	const credentials = { sessionId, token: randomBytes(32).toString("hex") };
	const projectId = toProjectNumber(config.id);
	const mailbox = new SqliteChatMailbox({
		projectId,
		db: openFigmaDatabase(machine.dbPath),
	});
	const permissionMailbox = new SqlitePermissionMailbox({
		projectId,
		db: openFigmaDatabase(machine.dbPath),
	});
	const cancelMailbox = new SqliteCancelMailbox({
		projectId,
		db: openFigmaDatabase(machine.dbPath),
	});
	const chatTokens = new FsChatTokens({
		dir: join(config.outputDir, CHAT_TOKENS_DIR),
	});

	// La configuración del proyecto (project@1, screens@1, areas@1): la leen la captura y los pasos del kit
	const projectConfig = new FsProjectConfig({
		projectDir: config.projectDir,
		scriptsRoots: config.scriptsRoots,
	});
	// La última captura válida de cada pantalla y el plan que se arma de ella (F4): una sola fuente de capturas para las dos
	const webCaptures = new FsWebCaptureStore(config.outputDir);
	const screenPlan = makeScreenPlan({
		store: webCaptures,
		clock: () => new Date(),
		checkCapture: (value) =>
			captureSchemaIssues(value).map((i) => ({
				pointer: i.path ?? "",
				message: i.message,
			})),
	});
	const sheetPlan = makeSheetPlan({
		store: webCaptures,
		clock: () => new Date(),
		checkCapture: (value) =>
			captureSchemaIssues(value).map((i) => ({
				pointer: i.path ?? "",
				message: i.message,
			})),
	});
	// compose@1: se lee de la carpeta del proyecto y se valida contra el catálogo del archivo abierto (solo lecturas)
	const composePlan = makeComposePlan({
		reader: tenant.reader,
		composes: new FsComposeStore(),
	});
	const runBuild = makeRunBuild({
		project: projectConfig,
		screenPlan,
		sheetPlan,
		composePlan,
		gateway: tenant.gateway,
		scripts: tenant.scripts,
		assets: tenant.assets,
		store: tenant.store,
		maxInlineResultBytes: machine.output.maxInlineResultBytes,
		jobs: tenant.jobs,
		stepTimeoutMs: machine.build.stepTimeoutMs,
		maxParamsBytes: machine.build.maxParamsBytes,
		maxSteps: machine.build.maxSteps,
		checkStep: stepResultIssues,
		attempts,
		onStepsChanged: recorder.buildStepsChanged,
		onProgress: (ev) => deps.progress.publish(ev),
		onJobFinished: recorder.buildFinished,
	});
	const cancelJob = makeCancelJob({ jobs: tenant.jobs });
	// Las lecturas del catálogo (M3) van por el flujo de jobs de run-script, sin el bloqueo de lote (decisiones 9 y 12)
	const readDeps = {
		runRead: makeRunRead({
			reader: tenant.reader,
			jobs: tenant.jobs,
			softDeadlineMs: machine.jobs.softDeadlineMs,
			onJobFinished: recorder.jobFinished,
		}),
		reader: tenant.reader,
		store: tenant.store,
		clock: () => new Date(),
	};
	const takeScreenshot = makeTakeScreenshot({
		gateway: tenant.gateway,
		store: tenant.store,
		now: () => new Date(),
	});
	const useCases: UseCases = {
		runScript: makeRunScript({
			gateway: tenant.gateway,
			scripts: tenant.scripts,
			assets: tenant.assets,
			store: tenant.store,
			jobs: tenant.jobs,
			softDeadlineMs: machine.jobs.softDeadlineMs,
			maxInlineResultBytes: machine.output.maxInlineResultBytes,
			maxParamsBytes: machine.build.maxParamsBytes,
			checkStep: stepResultIssues,
			attempts,
			onJobFinished: recorder.jobFinished,
		}),
		getJob: makeGetJob(tenant.jobs, {
			softDeadlineMs: machine.jobs.softDeadlineMs,
		}),
		getStatus: makeGetStatus(tenant.gateway, tenant.jobs),
		takeScreenshot,
		getMetadata: makeGetMetadata(tenant.gateway),
		runBuild,
		cancelJob,
		buildManifest: tenant.buildManifest,
		areaPlan: makeAreaPlan({ project: projectConfig, store: webCaptures }),
		sheetsPlan: makeSheetsPlan({ project: projectConfig, store: webCaptures }),
		reads: {
			designContext: makeReadDesignContext({
				...readDeps,
				project: projectConfig,
				screenshot: takeScreenshot,
				paintMatches: makeLastScreenMatches({ history: tenant.historyQuery }),
				fileKey: figmaFileKey(config.fileUrl) ?? "",
				maxNodes: machine.read.designContextMaxNodes,
			}),
			variables: makeReadVariables(readDeps),
			styles: makeReadStyles(readDeps),
			components: makeReadComponents(readDeps),
			instances: makeReadInstances(readDeps),
			export: makeExportNodes({
				...readDeps,
				maxNodes: machine.read.exportMaxNodes,
			}),
		},
		historyScript: makeHistoryScript({
			history: tenant.historyQueries,
			store: tenant.store,
		}),
		historyDiff: makeHistoryDiff({
			history: tenant.historyQueries,
			store: tenant.store,
			inlineLines: machine.history.diffInlineLines,
		}),
		// Captura de la web (F1): su propio Chrome (nunca el de Figma: solo recibe machine.web), el lock de captura de la
		// máquina y la carpeta de salida del proyecto; no pasa por la pestaña de Figma
		capture: makeCaptureScreens({
			project: projectConfig,
			secrets: new FsSecretStore(machine.web.secretsFile),
			capturer: new ChromeWebCapturer({
				bin: machine.web.chromeBin,
				port: machine.web.chromePort,
				profileDir: machine.web.profileDir,
			}),
			store: webCaptures,
			lock: deps.tabLocks.forUrl(CAPTURE_LOCK_NAME),
			jobs: tenant.jobs,
			softDeadlineMs: machine.jobs.softDeadlineMs,
			pageTimeoutMs: machine.web.pageTimeoutMs,
			captureMaxBytes: machine.web.captureMaxBytes,
			inlineErrors: machine.web.contractInlineErrors,
			checkSchema: captureSchemaIssues,
			attempts,
			clock: () => new Date(),
			localIso: (at) => toLocalIso(at.toISOString(), systemTimeZone()),
			onJobFinished: recorder.jobFinished,
		}),
	};

	let stopChatPolling = () => {};
	// Las cancelaciones que el panel pide para los lotes de esta sesión (la tenga o no chat) las ejecuta aquí
	const stopCancelPolling = startChatPolling({
		relay: {
			deliverPending: makeHandleCancelRequests({
				inbox: cancelMailbox,
				sessionId,
				cancelJob,
				warn,
			}),
		},
		pollMs: machine.chat.pollMs,
		warn,
	});
	const interruptOwnJobs = makeInterruptOwnJobs({
		maintenance: tenant.historyLog,
		sessionId,
		now: () => new Date(),
	});
	const dispose = (): void => {
		stopChatPolling();
		stopCancelPolling();
		chatTokens.revoke(sessionId);
		// Los jobs vivos de esta sesión no van a terminar: el panel no los puede dejar «en curso» para siempre
		try {
			interruptOwnJobs();
		} catch (e) {
			console.error("histórico: no se pudieron cerrar los jobs en marcha:", e);
		}
		tenant.client.close();
	};

	try {
		await makeMaintainHistory({
			importActivity: makeImportActivity({
				archive: new JsonlActivityArchive({ file: config.activityFile }),
				maintenance: tenant.historyLog,
				key: config.activityFile,
			}),
			pruneHistory: makePruneHistory({
				maintenance: tenant.historyLog,
				retentionDays: machine.history.retentionDays,
				now: () => new Date(),
			}),
			warn,
		})();
		// Los jobs que dejaron sesiones ya muertas (un apagado a la fuerza no pudo cerrarlos); las vivas no se tocan
		try {
			makeSweepDeadSessionJobs({
				maintenance: tenant.historyLog,
				sessionId,
				isAlive: isProcessAlive,
				now: () => new Date(),
			})();
		} catch (e) {
			console.error("histórico: no se pudieron barrer los jobs huérfanos:", e);
		}
		recorder.sessionStarted({ pid: process.pid, fileUrl: config.fileUrl });

		// Solo un agente de chat (`make agent` pone FCC_CHAT_AGENT) atiende el panel: se registra, publica su token
		// y sondea. Un `claude` normal conecta el MCP pero NO es agente de chat, así que el panel ofrece lanzar uno.
		if (machine.chat.agent) {
			mailbox.register(credentials);
			chatTokens.publish(sessionId, credentials.token);
			const chatRelay = createChatRelay({
				inbox: mailbox,
				credentials,
				push: pushToChannel(deps.server),
				warn,
			});
			const permissionRelay = createPermissionRelay({
				inbox: permissionMailbox,
				credentials,
				push: pushPermissionVerdict(deps.server),
				warn,
			});
			stopChatPolling = startChatPolling({
				relay: {
					// Los mensajes del panel y los veredictos de permisos comparten el mismo sondeo
					deliverPending: async () =>
						(await chatRelay.deliverPending()) +
						(await permissionRelay.deliverVerdicts()),
				},
				pollMs: machine.chat.pollMs,
				warn,
			});
		}
	} catch (e) {
		dispose();
		throw e;
	}

	return {
		tenant,
		useCases,
		recorder,
		history: tenant.historyQueries,
		replyChat: makeReplyChat({ outbox: mailbox, credentials }),
		recordPermission: makeRecordPermission({
			inbox: permissionMailbox,
			credentials,
		}),
		dispose,
	};
}
