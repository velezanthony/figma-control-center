import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	CaptureRun,
	makeCaptureScreens,
} from "#application/capture-screens.ts";
import type { ActivityRecorder } from "#application/record-activity.ts";
import { JOB_STATUS } from "#domain/job.ts";
import { captureInput, captureOutputShape } from "./capture-schemas.ts";
import { reply, type ToolReply, usageError } from "./presenters.ts";
import { TOOL_NAME } from "./schemas.ts";
import { track } from "./track.ts";

const EMPTY = {
	files: [],
	rejected: [],
	summary: [],
	errors: [],
	errorCount: 0,
	path: null,
} as const;

function present(run: CaptureRun): ToolReply {
	if (run.kind === "usage") return usageError(run.message);
	if (run.kind === "running")
		return reply(
			{
				ok: true,
				status: JOB_STATUS.running,
				jobId: run.jobId,
				...EMPTY,
				error: null,
				retryable: false,
				touchedNodeIds: [],
			},
			false,
		);
	if (!run.outcome.ok)
		return reply(
			{
				ok: false,
				status: JOB_STATUS.failed,
				jobId: run.jobId,
				...EMPTY,
				error: run.outcome.error,
				retryable: run.outcome.error.retryable,
				touchedNodeIds: [],
			},
			true,
		);
	const r = run.outcome.value;
	const ok = r.error === null;
	return reply(
		{
			ok,
			status: ok ? JOB_STATUS.done : JOB_STATUS.failed,
			jobId: run.jobId,
			path: r.files[0]?.path ?? r.rejected[0]?.path ?? null,
			files: r.files,
			rejected: r.rejected,
			summary: r.summary,
			errors: r.errors,
			errorCount: r.errorCount,
			error: r.error,
			retryable: r.error?.retryable ?? false,
			touchedNodeIds: [],
		},
		!ok,
	);
}

export function registerCaptureTools(
	server: McpServer,
	capture: ReturnType<typeof makeCaptureScreens>,
	recorder: ActivityRecorder,
): void {
	server.registerTool(
		TOOL_NAME.capture,
		{
			title: "Capturar la web",
			description:
				"Captura pantallas de la web del proyecto (las de su screens@1, por clave) en un Chrome de captura aparte: nunca el de Figma. No toca Figma (touchedNodeIds siempre vacío). Lee figma-control-center.json de la carpeta del proyecto, entra por el formulario de login con el usuario de la pantalla si lo pide y juzga cada captura con capture@1: la válida va a web-captures/<día>/ de la carpeta de salida y la que no cumple, a rejected/ con sus errores (código, id y ruta del nodo). La respuesta trae solo `files`, un `summary` por pantalla y como mucho FCC_CONTRACT_INLINE_ERRORS errores: lee el árbol del fichero. Las pantallas con `evaluateInPage` piden `allowPageWorld: true`. Una sola captura a la vez en la máquina. Si tarda más que el plazo blando devuelve status=running y un jobId: consulta figma_get_job (con waitMs). Las capturas de la web no salen en Capturas del panel.",
			inputSchema: captureInput,
			outputSchema: captureOutputShape,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		(args) =>
			track(recorder, TOOL_NAME.capture, args, async (call) =>
				present(await capture({ ...args, callId: call.callId })),
			),
	);
}
