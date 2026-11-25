// Contrato de la frontera CDP (Chrome DevTools Protocol). Los dobles validan contra él todo lo que emiten.
// Fuentes oficiales:
//  - Dominio Runtime (Runtime.evaluate, RemoteObject, ExceptionDetails, StackTrace, CallFrame):
//    https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
//  - Mensajes (id, result, error) y endpoints HTTP (/json/list):
//    https://chromedevtools.github.io/devtools-protocol/ y
//    https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc
//  - PUT /json/new?{url} (abre una pestaña y devuelve su destino) y /json/close/{id} («Target is closing»):
//    https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc
//    (desde Chrome 111 /json/new exige PUT; un GET da 405)
//  - Forma de `Error.stack` en V8: https://v8.dev/docs/stack-trace-api
import { z } from "zod";

export const CDP_CONTRACT_SOURCES = Object.freeze([
	"https://chromedevtools.github.io/devtools-protocol/tot/Runtime/",
	"https://v8.dev/docs/stack-trace-api",
] as const);

// GET /json/list: una entrada por destino (pestaña, popup de Chrome…)
export const TargetInfoSchema = z.looseObject({
	id: z.string(),
	type: z.string(),
	title: z.string(),
	url: z.string(),
	description: z.string().optional(),
	devtoolsFrontendUrl: z.string().optional(),
	faviconUrl: z.string().optional(),
	webSocketDebuggerUrl: z.string().optional(),
});
export const TargetListSchema = z.array(TargetInfoSchema);

// Runtime.evaluate (petición): `expression` obligatoria; el resto, opciones documentadas
export const EvaluateRequestSchema = z.looseObject({
	id: z.number().int(),
	method: z.literal("Runtime.evaluate"),
	params: z.looseObject({
		expression: z.string(),
		awaitPromise: z.boolean().optional(),
		returnByValue: z.boolean().optional(),
	}),
});

const REMOTE_OBJECT_TYPES = [
	"object",
	"function",
	"undefined",
	"string",
	"number",
	"boolean",
	"symbol",
	"bigint",
] as const;

// Runtime.RemoteObject
export const RemoteObjectSchema = z.strictObject({
	type: z.enum(REMOTE_OBJECT_TYPES),
	subtype: z.string().optional(),
	className: z.string().optional(),
	value: z.unknown().optional(),
	unserializableValue: z.string().optional(),
	description: z.string().optional(),
	objectId: z.string().optional(),
	preview: z.unknown().optional(),
	customPreview: z.unknown().optional(),
	deepSerializedValue: z.unknown().optional(),
});

// Runtime.CallFrame
export const CallFrameSchema = z.strictObject({
	functionName: z.string(),
	scriptId: z.string(),
	url: z.string(),
	lineNumber: z.number().int().min(0),
	columnNumber: z.number().int().min(0),
});

export type StackTrace = {
	description?: string | undefined;
	callFrames: z.infer<typeof CallFrameSchema>[];
	parent?: StackTrace | undefined;
	parentId?: unknown;
};
// Runtime.StackTrace (recursivo por `parent`)
export const StackTraceSchema: z.ZodType<StackTrace> = z.lazy(() =>
	z.strictObject({
		description: z.string().optional(),
		callFrames: z.array(CallFrameSchema),
		parent: StackTraceSchema.optional(),
		parentId: z.unknown().optional(),
	}),
);

// Runtime.ExceptionDetails (lineNumber y columnNumber desde 0)
export const ExceptionDetailsSchema = z.strictObject({
	exceptionId: z.number().int(),
	text: z.string(),
	lineNumber: z.number().int().min(0),
	columnNumber: z.number().int().min(0),
	scriptId: z.string().optional(),
	url: z.string().optional(),
	stackTrace: StackTraceSchema.optional(),
	exception: RemoteObjectSchema.optional(),
	executionContextId: z.number().int().optional(),
	exceptionMetaData: z.unknown().optional(),
});

// Respuesta de Runtime.evaluate: resultado (con o sin excepción) o error de protocolo
export const EvaluateSuccessSchema = z.strictObject({
	id: z.number().int(),
	sessionId: z.string().optional(),
	result: z.strictObject({
		result: RemoteObjectSchema,
		exceptionDetails: ExceptionDetailsSchema.optional(),
	}),
});
export const ProtocolErrorSchema = z.strictObject({
	id: z.number().int(),
	sessionId: z.string().optional(),
	error: z.strictObject({
		code: z.number().int(),
		message: z.string(),
		data: z.string().optional(),
	}),
});
export const EvaluateResponseSchema = z.union([
	EvaluateSuccessSchema,
	ProtocolErrorSchema,
]);

// `exception.description` de un Error: «Nombre: mensaje» y un marco por línea con cuatro espacios y «at».
// Marco: «    at fn (origen:línea:col)» o «    at origen:línea:col»; el origen del código evaluado es «<anonymous>»
export const STACK_FRAME = /^ {4}at (?:.+ \()?[^\s()]+:\d+:\d+\)?$/;
export const StackDescriptionSchema = z.string().refine(
	(text) => {
		const [head, ...frames] = text.split("\n");
		return (
			head !== undefined &&
			head !== "" &&
			frames.every((line) => STACK_FRAME.test(line))
		);
	},
	{
		message:
			"descripción de pila no válida: «Nombre: mensaje» + marcos «    at …:L:C»",
	},
);

export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;

// Constructores: un ejemplo se construye desde el contrato (y se valida al construirlo), no se copia de una salida real
export const SCRIPT_ORIGIN = "<anonymous>";
export const FIGMA_BUNDLE_ORIGIN = "https://static.figma.com/app/bundle.js";

export type Frame = {
	readonly fn?: string;
	readonly origin: string;
	readonly line: number;
	readonly column: number;
};

export const stackDescription = (
	name: string,
	message: string,
	frames: readonly Frame[],
): string =>
	StackDescriptionSchema.parse(
		[
			`${name}: ${message}`,
			...frames.map(
				(f) =>
					`    at ${f.fn === undefined ? "" : `${f.fn} (`}${f.origin}:${f.line}:${f.column}${f.fn === undefined ? "" : ")"}`,
			),
		].join("\n"),
	);

export const valueReply = (id: number, value: unknown): EvaluateResponse => {
	const remote =
		value === undefined
			? { type: "undefined" }
			: value === null
				? { type: "object", subtype: "null", value: null }
				: typeof value === "string" ||
						typeof value === "number" ||
						typeof value === "boolean"
					? { type: typeof value, value }
					: { type: "object", value };
	return EvaluateResponseSchema.parse({ id, result: { result: remote } });
};

export const exceptionReply = (
	id: number,
	error: {
		readonly className: string;
		readonly message: string;
		readonly frames: readonly Frame[];
		// 0-based (solo los errores de sintaxis lo informan con sentido)
		readonly lineNumber?: number;
	},
): EvaluateResponse =>
	EvaluateResponseSchema.parse({
		id,
		result: {
			result: { type: "object", subtype: "error", className: error.className },
			exceptionDetails: {
				exceptionId: 1,
				text: "Uncaught",
				lineNumber: error.lineNumber ?? 0,
				columnNumber: 0,
				exception: {
					type: "object",
					subtype: "error",
					className: error.className,
					description: stackDescription(
						error.className,
						error.message,
						error.frames,
					),
				},
			},
		},
	});

export const protocolErrorReply = (
	id: number,
	code: number,
	message: string,
): EvaluateResponse =>
	EvaluateResponseSchema.parse({ id, error: { code, message } });
