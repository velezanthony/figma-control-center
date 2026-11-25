import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { makeAreaPlan } from "#application/area-plan.ts";
import type { makeCancelJob } from "#application/cancel-job.ts";
import type { makeCaptureScreens } from "#application/capture-screens.ts";
import type { makeGetJob } from "#application/get-job.ts";
import type { makeGetMetadata } from "#application/get-metadata.ts";
import type { makeGetStatus } from "#application/get-status.ts";
import type { makeHistoryDiff } from "#application/history-diff.ts";
import type { makeHistoryScript } from "#application/history-script.ts";
import type { BuildManifest } from "#application/ports/build-manifest.ts";
import type { ActivityRecorder } from "#application/record-activity.ts";
import type { makeRunBuild } from "#application/run-build.ts";
import type { makeRunScript } from "#application/run-script.ts";
import type { makeSheetsPlan } from "#application/sheets-plan.ts";
import type { makeTakeScreenshot } from "#application/take-screenshot.ts";
import { JOB_STATUS } from "#domain/job.ts";
import type { BuildProgressBus } from "./build-progress.ts";
import { makeProgressNotifier } from "./build-progress.ts";
import {
	jobOutput,
	metadataOutput,
	outcomeOutput,
	reply,
	runningOutput,
	screenshotOutput,
	statusOutput,
	usageError,
} from "./presenters.ts";
import type { ReadUseCases } from "./read-tools.ts";
import {
	getJobInput,
	getJobOutputShape,
	metadataInput,
	metadataOutputShape,
	runOutputShape,
	runScriptInput,
	screenshotInput,
	screenshotOutputShape,
	statusOutputShape,
	TOOL_NAME,
} from "./schemas.ts";
import { limitTouched, type TouchedLimit } from "./touched-file.ts";
import { track } from "./track.ts";

export type UseCases = {
	readonly runScript: ReturnType<typeof makeRunScript>;
	readonly getJob: ReturnType<typeof makeGetJob>;
	readonly getStatus: ReturnType<typeof makeGetStatus>;
	readonly takeScreenshot: ReturnType<typeof makeTakeScreenshot>;
	readonly getMetadata: ReturnType<typeof makeGetMetadata>;
	readonly runBuild: ReturnType<typeof makeRunBuild>;
	readonly cancelJob: ReturnType<typeof makeCancelJob>;
	readonly buildManifest: BuildManifest;
	// El plan de un figma_build { areas } (F3)
	readonly areaPlan: ReturnType<typeof makeAreaPlan>;
	// El plan de un figma_build { sheets } (hojas de componentes)
	readonly sheetsPlan: ReturnType<typeof makeSheetsPlan>;
	// Lecturas del catálogo (M3)
	readonly reads: ReadUseCases;
	// Captura de la web (F1): no toca Figma
	readonly capture: ReturnType<typeof makeCaptureScreens>;
	// figma_history_script: vuelca el contenido de un intento a la carpeta de salida
	readonly historyScript: ReturnType<typeof makeHistoryScript>;
	// figma_history_diff: qué cambió entre dos intentos del mismo objetivo
	readonly historyDiff: ReturnType<typeof makeHistoryDiff>;
};

export const OPEN_WORLD_READ = {
	readOnlyHint: true,
	idempotentHint: true,
	openWorldHint: true,
} as const;

// Notificaciones de progreso de un lote: las envía figma_get_job mientras espera (waitMs) si la petición trae
// progressToken. Reloj del throttle: el del sistema por defecto (se inyecta en los tests).
export type ProgressDeps = {
	readonly bus: BuildProgressBus;
	readonly minIntervalMs: number;
	readonly now?: () => number;
};

export function registerTools(
	server: McpServer,
	uc: UseCases,
	recorder: ActivityRecorder,
	touched: TouchedLimit,
	progress: ProgressDeps,
): void {
	server.registerTool(
		TOOL_NAME.runScript,
		{
			title: "Ejecutar script en Figma",
			description:
				"Ejecuta un script del API de plugins de Figma en el archivo abierto. Pasa `file` (ruta) para scripts largos; `code` solo para fragmentos cortos. Devuelve el resultado pequeño y los ids de los nodos tocados (`createdNodeIds`/`mutatedNodeIds` que el script declare en su return; ejemplo: `return { createdNodeIds: ['1:2'], mutatedNodeIds: ['1:3'] }`; si no devuelve ninguna de las dos listas, la respuesta trae `warning`; una lista vacía ya declara que no tocó nada). El script recibe `kit`, el kit de Figma (figma-kit@1: páginas, nodos por clave, componentes, instancias, slots, fuentes, variables, iconos), ya instalado en la pestaña; con `// @contract step@1 · <qué hace>` en la primera línea su resultado se juzga contra step@1 (`kit.track().done()` lo arma). Si tarda más que el plazo blando devuelve status=running y un jobId: consulta figma_get_job. Un script largo no sobrevive al cliente: si este se va con el job en marcha, el job queda `Interrupted` y el script pudo seguir o terminar en Figma (el servidor no puede saberlo); para algo largo, trocéalo en pasos con figma_build, que se puede cancelar y dice en cuál se cortó. Escribe en el archivo real: no la uses solo para leer (para eso figma_metadata). En un fallo, `retryable` es false si el error es de tu llamada (ruta, script, params) o incierto (plazo), y true si es del entorno (Chrome, pestaña, sesión): el `nextStep` dice qué cambiar o qué arreglar.",
			inputSchema: runScriptInput,
			outputSchema: runOutputShape,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		(args) =>
			track(recorder, TOOL_NAME.runScript, args, async (call) => {
				const { file, code, format, timeoutMs, params, assets, resultFile } =
					args;
				if ((file === undefined) === (code === undefined)) {
					return usageError("Indica exactamente uno de `file` o `code`.");
				}
				const result = await uc.runScript({
					source:
						file !== undefined
							? { kind: "file", path: file }
							: { kind: "code", code: code ?? "" },
					format,
					timeoutMs,
					...(params !== undefined && { params }),
					...(assets !== undefined && { assets }),
					...(resultFile !== undefined && { resultFile }),
					callId: call.callId,
				});
				if (result.kind === "running") {
					return reply(runningOutput(result.jobId), false);
				}
				if (result.kind === "usage") {
					return usageError(result.message);
				}
				return reply(outcomeOutput(result.outcome, null), !result.outcome.ok);
			}),
	);

	server.registerTool(
		TOOL_NAME.getJob,
		{
			title: "Consultar job",
			description:
				"Estado y resultado de un job que figma_run_script o figma_build dejó en marcha (status=running). Con `waitMs` espera a que termine y responde en cuanto lo hace (o al vencer, con el estado de ese momento; tope: el plazo blando); sin él responde al instante. Cuando termina devuelve el mismo contrato que figma_run_script. Si el job es un lote de figma_build añade kind=build, progress (done, total, cancelled, skipped) y steps. Los jobs viven en memoria: se pierden si el servidor se reinicia.",
			inputSchema: getJobInput,
			outputSchema: getJobOutputShape,
			annotations: {
				readOnlyHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(args, extra) =>
			track(recorder, TOOL_NAME.getJob, args, async () => {
				const token = extra._meta?.progressToken;
				const notifier =
					token === undefined || args.waitMs === undefined
						? null
						: makeProgressNotifier({
								send: (message, done, total) =>
									extra.sendNotification({
										method: "notifications/progress",
										params: {
											progressToken: token,
											progress: done,
											total,
											message,
										},
									}),
								minIntervalMs: progress.minIntervalMs,
								...(progress.now !== undefined && { now: progress.now }),
							});
				const stop =
					notifier === null
						? () => {}
						: progress.bus.listen((ev) => notifier.push(ev));
				let job: Awaited<ReturnType<typeof uc.getJob>>;
				try {
					job = await uc.getJob(args.jobId, args.waitMs, extra.signal);
				} finally {
					// Primero nos damos de baja del bus (síncrono) y luego se vacía el throttle: el último paso
					// siempre se notifica y ninguno sale tras responder.
					stop();
					if (notifier !== null) await notifier.flush();
				}
				if (job === null) {
					return usageError(
						`No existe el job ${args.jobId} (nunca se creó o el servidor se reinició).`,
					);
				}
				const output = jobOutput(job);
				const body =
					"kind" in output ? await limitTouched(output, touched) : output;
				return reply(body, output.status === JOB_STATUS.failed);
			}),
	);

	server.registerTool(
		TOOL_NAME.status,
		{
			title: "Estado de la conexión con Figma",
			description:
				"Diagnóstico: ¿responde Chrome?, ¿está abierta la pestaña del archivo?, ¿está listo el objeto figma?, archivo y página actual. Si algo falla devuelve el error y el siguiente paso. Úsala primero cuando otra herramienta falle.",
			outputSchema: statusOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		() =>
			track(recorder, TOOL_NAME.status, {}, async () =>
				reply(statusOutput(await uc.getStatus()), false),
			),
	);

	server.registerTool(
		TOOL_NAME.screenshot,
		{
			title: "Captura de un nodo",
			description:
				"Exporta un nodo a PNG en el directorio de salida y devuelve la ruta y el tamaño; la imagen no viaja por la conversación (ábrela desde la ruta si necesitas verla). No modifica Figma.",
			inputSchema: screenshotInput,
			outputSchema: screenshotOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.screenshot, args, async () => {
				const output = screenshotOutput(
					await uc.takeScreenshot(args.nodeId, args.scale),
				);
				return reply(output, !output.ok);
			}),
	);

	server.registerTool(
		TOOL_NAME.metadata,
		{
			title: "Árbol de capas",
			description:
				"Árbol ligero { id, name, type, children? } de un nodo (por defecto la página actual) hasta `depth` niveles. Solo lectura: úsala para localizar ids antes de escribir o capturar.",
			inputSchema: metadataInput,
			outputSchema: metadataOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.metadata, args, async () => {
				const output = metadataOutput(
					await uc.getMetadata(args.nodeId ?? null, args.depth),
				);
				return reply(output, !output.ok);
			}),
	);
}
