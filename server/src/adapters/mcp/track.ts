import type {
	ActivityCall,
	ActivityRecorder,
	ToolFinishedInfo,
} from "#application/record-activity.ts";
import { ACTIVITY_ERROR, type ActivityError } from "#domain/activity.ts";
import type { ToolReply } from "./presenters.ts";
import { TOOL_NAME } from "./schemas.ts";

type Structured = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Structured =>
	typeof v === "object" && v !== null;
const asString = (v: unknown): string | undefined =>
	typeof v === "string" ? v : undefined;
const asNumber = (v: unknown): number | undefined =>
	typeof v === "number" ? v : undefined;

// El `error` de una salida estructurada es un FigmaError serializado
function errorOf(value: unknown): ActivityError | undefined {
	if (!isRecord(value)) return undefined;
	const type = asString(value["type"]);
	const message = asString(value["message"]);
	if (type === undefined || message === undefined) return undefined;
	return {
		type,
		message,
		nextStep: asString(value["nextStep"]) ?? null,
		line: asNumber(value["line"]) ?? null,
	};
}

const textOf = (reply: ToolReply): string => reply.content[0]?.text ?? "";

// La salida de una herramienta ya trae todo lo que el panel necesita: se lee de ahí
function finishedInfo(reply: ToolReply): ToolFinishedInfo {
	const out: Structured = reply.structuredContent ?? {};
	const ok = !reply.isError && out["ok"] !== false;
	const result = out["result"];
	const resultPath =
		(isRecord(result) ? asString(result["path"]) : undefined) ??
		asString(out["path"]);
	const jobId = asString(out["jobId"]);
	const error =
		errorOf(out["error"]) ??
		(reply.structuredContent === undefined && reply.isError
			? {
					type: ACTIVITY_ERROR.usage,
					message: textOf(reply),
					nextStep: null,
					line: null,
				}
			: undefined);
	const touched = out["touchedNodeIds"];
	return {
		ok,
		touchedNodeIds: Array.isArray(touched)
			? touched.filter((id): id is string => typeof id === "string")
			: [],
		...(typeof out["retryable"] === "boolean" && {
			retryable: out["retryable"],
		}),
		...(error !== undefined && { error }),
		...(resultPath !== undefined && { resultPath }),
		...(jobId !== undefined && { jobId }),
	};
}

function recordSpecificEvents(
	call: ActivityCall,
	tool: string,
	args: Structured,
	reply: ToolReply,
): void {
	const out: Structured = reply.structuredContent ?? {};
	if (tool === TOOL_NAME.screenshot && out["ok"] === true) {
		const nodeId = asString(args["nodeId"]);
		const path = asString(out["path"]);
		const width = asNumber(out["width"]);
		const height = asNumber(out["height"]);
		if (
			nodeId !== undefined &&
			path !== undefined &&
			width !== undefined &&
			height !== undefined
		) {
			call.screenshotSaved({ nodeId, path, width, height });
		}
	}
	if (tool === TOOL_NAME.status) {
		call.statusChecked({
			chromeReachable: out["chromeReachable"] === true,
			tabFound: out["tabFound"] === true,
			figmaReady: out["figmaReady"] === true,
			fileName: asString(out["fileName"]) ?? null,
			pageName: asString(out["pageName"]) ?? null,
		});
	}
}

// Envuelve el manejador de una herramienta: registra la llamada y su final sin cambiar la respuesta
export async function track(
	recorder: ActivityRecorder,
	tool: string,
	args: Structured,
	// Recibe la llamada ya abierta: su `callId` enlaza con ella lo que la herramienta guarde (los intentos)
	run: (call: ActivityCall) => Promise<ToolReply> | ToolReply,
): Promise<ToolReply> {
	const call = recorder.startCall(tool, args);
	let reply: ToolReply;
	try {
		reply = await run(call);
	} catch (e) {
		call.finished({
			ok: false,
			touchedNodeIds: [],
			error: {
				type: ACTIVITY_ERROR.unexpected,
				message: e instanceof Error ? e.message : String(e),
				nextStep: null,
				line: null,
			},
		});
		throw e;
	}
	recordSpecificEvents(call, tool, args, reply);
	call.finished(finishedInfo(reply));
	return reply;
}
