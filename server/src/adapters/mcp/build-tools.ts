import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_STEP_FORMAT } from "#adapters/contracts/build-manifest.ts";
import type { makeAreaPlan } from "#application/area-plan.ts";
import type { makeCancelJob } from "#application/cancel-job.ts";
import type { BuildManifest } from "#application/ports/build-manifest.ts";
import type { ActivityRecorder } from "#application/record-activity.ts";
import type { makeRunBuild } from "#application/run-build.ts";
import type { makeSheetsPlan, SkippedSheet } from "#application/sheets-plan.ts";
import {
	BUILD_STATUS,
	type BuildPlan,
	type KitUseInput,
	kitPlanStep,
	type PlanStep,
} from "#domain/build.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { toJobId } from "#domain/job.ts";
import {
	buildOutput,
	cancelOutput,
	cancelRequestedOutput,
	reply,
	usageError,
} from "./presenters.ts";
import {
	buildInput,
	buildOutputShape,
	cancelInput,
	cancelOutputShape,
	TOOL_NAME,
} from "./schemas.ts";
import { limitTouched, type TouchedLimit } from "./touched-file.ts";
import { track } from "./track.ts";

export type BuildUseCases = {
	readonly runBuild: ReturnType<typeof makeRunBuild>;
	readonly cancelJob: ReturnType<typeof makeCancelJob>;
	readonly buildManifest: BuildManifest;
	readonly areaPlan: ReturnType<typeof makeAreaPlan>;
	readonly sheetsPlan: ReturnType<typeof makeSheetsPlan>;
};

export type BuildToolsDeps = { readonly touched: TouchedLimit };

// El lote entero se rechaza sin tocar Figma: respuesta común con ok:false y el error; `retryable` es el de su error
const failedPlanOutput = (error: FigmaError) =>
	reply(
		buildOutput(
			{
				ok: false,
				status: BUILD_STATUS.failed,
				error,
				touchedNodeIds: [],
				retryable: error.retryable,
				progress: {
					done: 0,
					total: 0,
					cancelled: 0,
					skipped: 0,
					current: null,
				},
				steps: [],
			},
			null,
		),
		true,
	);

export function registerBuildTools(
	server: McpServer,
	uc: BuildUseCases,
	recorder: ActivityRecorder,
	deps: BuildToolsDeps,
): void {
	const planFromSteps = (
		steps: readonly (
			| {
					readonly file: string;
					readonly format?: PlanStep["format"] | undefined;
					readonly params?: Readonly<Record<string, unknown>> | undefined;
					readonly assets?: Readonly<Record<string, string>> | undefined;
					readonly timeoutMs?: number | undefined;
			  }
			| KitUseInput
		)[],
		callParams: Readonly<Record<string, unknown>> | undefined,
	): BuildPlan => ({
		name:
			steps[0] === undefined
				? "lote"
				: "use" in steps[0]
					? kitPlanStep(steps[0], DEFAULT_STEP_FORMAT).file
					: steps[0].file,
		steps: steps.map((s): PlanStep => {
			// Un paso del kit: sus params salen de areas@1 o de la captura, no de la llamada
			if ("use" in s) return kitPlanStep(s, DEFAULT_STEP_FORMAT);
			const merged = { ...callParams, ...s.params };
			return {
				file: s.file,
				format: s.format ?? DEFAULT_STEP_FORMAT,
				...(Object.keys(merged).length > 0 && { params: merged }),
				...(s.assets !== undefined && { assets: s.assets }),
				...(s.timeoutMs !== undefined && { timeoutMs: s.timeoutMs }),
			};
		}),
	});

	server.registerTool(
		TOOL_NAME.build,
		{
			title: "Ejecutar un lote de scripts en Figma",
			description:
				'Reconstruye un área en una sola llamada: ejecuta en orden los pasos de un manifiesto (ruta), de una lista corta (`steps`, de script, del kit con `{ use, area }` o `{ use: "kit/build-screen@1", screen, area? }`, que pinta una pantalla desde su última captura de la web, o `{ use: "kit/build-component@1", sheet, scratch? }`, que pinta la hoja de un componente desde su captura, sheets@1 y map@1, o `{ use: "kit/compose@1", compose }`, que pinta una pantalla diseñada en Figma sin web previa desde su compose@1, solo con instancias de hojas, variables y estilos, y rechaza antes de tocar Figma un valor suelto o una pieza que no existe) o el plan de unas áreas del proyecto (`areas`, sin manifiesto: lo arma desde areas@1 y antepone a cada pantalla con captura su build-screen) o el de unas hojas de componentes (`sheets`: un `kit/build-component@1` por hoja, en el orden de sheets@1; una hoja sin captura válida no tiene paso y sale en `skippedSheets` con NO_SOURCE). Responde en cuanto acepta el lote, con status=running, el jobId y el plan entero en `steps`; un error de validación (ruta, manifiesto, script, asset, params) llega en esta misma respuesta, sin job y sin tocar Figma. `expect: { fileName }` (en el manifiesto o en la llamada) es una guarda: si el archivo abierto no se llama así, el lote se rechaza antes de enviar nada, también con `fromStep`. El lote corre en segundo plano: espera su final con figma_get_job (jobId, waitMs) y míralo o cancélalo con figma_cancel_job cuando quieras. Un lote a la vez: mientras corre, otro figma_build o figma_run_script se rechazan.',
			inputSchema: buildInput,
			outputSchema: buildOutputShape,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		(args) =>
			track(recorder, TOOL_NAME.build, args, async (call) => {
				const {
					manifest,
					steps,
					areas,
					sheets,
					fromStep,
					stopOnError,
					params,
					expect,
				} = args;
				const given = [manifest, steps, areas, sheets].filter(
					(x) => x !== undefined,
				);
				if (given.length !== 1) {
					return usageError(
						"Indica exactamente uno de `manifest`, `steps`, `areas` o `sheets`.",
					);
				}

				let plan: BuildPlan;
				let skippedSheets: readonly SkippedSheet[] = [];
				if (manifest !== undefined) {
					const read = await uc.buildManifest.read(manifest, params);
					if (!read.ok) return failedPlanOutput(read.error);
					plan = read.value;
				} else if (areas !== undefined) {
					const built = await uc.areaPlan(areas);
					if (built.kind === "usage") return usageError(built.message);
					if (built.kind === "error") return failedPlanOutput(built.error);
					plan = built.plan;
				} else if (sheets !== undefined) {
					const built = await uc.sheetsPlan(sheets);
					if (built.kind === "usage") return usageError(built.message);
					if (built.kind === "error") return failedPlanOutput(built.error);
					plan = built.plan;
					skippedSheets = built.skipped;
				} else {
					plan = planFromSteps(steps ?? [], params);
				}

				if (expect !== undefined) plan = { ...plan, expect };

				const result = await uc.runBuild({
					plan,
					fromStep,
					stopOnError,
					callId: call.callId,
				});
				if (result.kind === "usage") return usageError(result.message);
				return reply(
					await limitTouched(
						{
							...buildOutput(result.outcome, result.jobId),
							...(skippedSheets.length > 0 && { skippedSheets }),
						},
						deps.touched,
					),
					!result.outcome.ok,
				);
			}),
	);

	server.registerTool(
		TOOL_NAME.cancelJob,
		{
			title: "Cancelar un lote en marcha",
			description:
				"Cancela un lote de figma_build entre pasos: el paso en curso termina y los siguientes no se envían a Figma. Responde enseguida, sin esperar al paso en curso, con el progreso y los pasos reales y cancelRequested=true si el lote aún no ha acabado; el estado final se ve con figma_get_job (jobId, waitMs). Si el lote ya había terminado devuelve su estado final. No sirve para un figma_run_script en marcha (Figma no permite interrumpir un script).",
			inputSchema: cancelInput,
			outputSchema: cancelOutputShape,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		(args) =>
			track(recorder, TOOL_NAME.cancelJob, args, async () => {
				const result = await uc.cancelJob({ jobId: toJobId(args.jobId) });
				if (result.kind === "usage") return usageError(result.message);
				if (result.kind === "cancelRequested") {
					return reply(
						await limitTouched(
							cancelRequestedOutput(result.outcome, result.jobId),
							deps.touched,
						),
						false,
					);
				}
				return reply(
					await limitTouched(
						cancelOutput(result.outcome, result.jobId),
						deps.touched,
					),
					!result.outcome.ok,
				);
			}),
	);
}
