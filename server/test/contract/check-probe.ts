// Comprueba la respuesta de UNA sonda contra los contratos de las fronteras y devuelve las violaciones (vacío = cumple).
// La usan `make e2e-contract` (con la respuesta real del archivo de pruebas) y las pruebas herméticas que alteran una
// respuesta a propósito para comprobar que el contrato la rechaza (CA-4).
import { toScriptError } from "#adapters/cdp/script-error.ts";
import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";
import { ParamsEchoSchema } from "../contracts/build.ts";
import {
	EvaluateResponseSchema,
	EvaluateSuccessSchema,
	ProtocolErrorSchema,
	STACK_FRAME,
	StackDescriptionSchema,
} from "../contracts/cdp.ts";
import {
	AccessStateSchema,
	ComponentsValueSchema,
	ExportValueSchema,
	exportNodesSchema,
	InstancesValueSchema,
	MetadataNodeSchema,
	pngDimensions,
	StatusValueSchema,
	StylesValueSchema,
	VariablesValueSchema,
	WriteResultSchema,
} from "../contracts/figma-values.ts";
import {
	evaluation,
	markerLine,
	PROBE_COLLECTION,
	PROBE_COMPONENT,
	PROBE_FRAME,
	PROBE_FRAME_SIZE,
	PROBE_SET,
	PROBE_STYLE,
	type Probe,
} from "./probes.ts";

const isAliasTo = (value: unknown, name: string): boolean =>
	typeof value === "object" &&
	value !== null &&
	"alias" in value &&
	(value as { alias: { name: unknown } }).alias.name === name;

// Lo que cada sonda de lectura creó tiene que volver tal cual: el contrato dice la forma, esto lo que debe haber
function readProblems(probe: Probe, value: unknown): string[] {
	switch (probe.expects) {
		case "variables": {
			const r = VariablesValueSchema.safeParse(value);
			if (!r.success) return issues("variables", r.error);
			const [collection, ...rest] = r.data.collections;
			if (collection?.name !== PROBE_COLLECTION || rest.length > 0)
				return [`variables: se esperaba solo la colección ${PROBE_COLLECTION}`];
			const problems: string[] = [];
			if (!collection.modes.some((m) => m.id === collection.defaultModeId))
				problems.push("variables: falta el modo por defecto de la colección");
			const values = collection.variables.flatMap((v) =>
				Object.values(v.valuesByMode),
			);
			if (!values.some((v) => isAliasTo(v, `${PROBE_COLLECTION}/base`)))
				problems.push(
					"variables: falta el alias con id y nombre de la variable base",
				);
			if (!(r.data.bindings ?? []).some((b) => b.field === "fills"))
				problems.push(
					"variables: falta el enlace de la variable en los fills del marco",
				);
			return problems;
		}
		case "styles": {
			const r = StylesValueSchema.safeParse(value);
			if (!r.success) return issues("estilos", r.error);
			const style = r.data.styles.find((s) => s.name === PROBE_STYLE);
			return style?.kind === "paint" && style.value[0]?.type === "SOLID"
				? []
				: [`estilos: falta el estilo de pintura ${PROBE_STYLE} con su SOLID`];
		}
		case "components": {
			const r = ComponentsValueSchema.safeParse(value);
			if (!r.success) return issues("componentes", r.error);
			const set = r.data.components.find((c) => c.name === PROBE_SET);
			return set?.type === "COMPONENT_SET" &&
				set.variantCount === 2 &&
				JSON.stringify(set.variants) === JSON.stringify({ Tamaño: ["S", "M"] })
				? []
				: [`componentes: falta el set ${PROBE_SET} con Tamaño S y M`];
		}
		case "instances": {
			const r = InstancesValueSchema.safeParse(value);
			if (!r.success) return issues("instancias", r.error);
			const frames = r.data.frames.filter((f) => f.frameName === PROBE_FRAME);
			const expected = { [PROBE_SET]: 1, [PROBE_COMPONENT]: 1 };
			return frames.length === 1 &&
				JSON.stringify(frames[0]?.counts) === JSON.stringify(expected)
				? []
				: [
						`instancias: se esperaba un marco ${PROBE_FRAME} con ${JSON.stringify(expected)}`,
					];
		}
		case "exportNodes": {
			const format = probe.exportFormat ?? "PNG";
			const r = exportNodesSchema(format).safeParse(value);
			if (!r.success) return issues(`exportación ${format}`, r.error);
			if (r.data.nodes.length !== 1)
				return [`exportación ${format}: se esperaba un nodo`];
			if (format !== "PNG") return [];
			const size = pngDimensions(
				Buffer.from(r.data.nodes[0]?.base64 ?? "", "base64"),
			);
			return JSON.stringify(size) === JSON.stringify(PROBE_FRAME_SIZE)
				? []
				: [`exportación PNG: tamaño ${JSON.stringify(size)} ≠ 40×30`];
		}
		default:
			return [];
	}
}

const SCRIPT_FRAME = /<anonymous>:\d+:\d+/;
const EXPECTED_CLASS = Object.freeze({
	syntaxError: "SyntaxError",
	runtimeError: "TypeError",
} as const);

const issues = (
	label: string,
	error: { issues: readonly { path: PropertyKey[]; message: string }[] },
): string[] =>
	error.issues.map(
		(i) => `${label}: ${i.path.join(".") || "(raíz)"} ${i.message}`,
	);

export function checkProbeReply(probe: Probe, reply: unknown): string[] {
	const envelope = EvaluateResponseSchema.safeParse(reply);
	if (!envelope.success) {
		// La unión esconde el motivo («Invalid input»): se vuelve a validar con la rama que corresponde al mensaje
		const branch =
			typeof reply === "object" && reply !== null && "error" in reply
				? ProtocolErrorSchema.safeParse(reply)
				: EvaluateSuccessSchema.safeParse(reply);
		return issues(
			"Runtime.evaluate",
			branch.success ? envelope.error : branch.error,
		);
	}
	if (!("result" in envelope.data)) {
		return [
			`Runtime.evaluate: error de protocolo ${envelope.data.error.message}`,
		];
	}
	const { result, exceptionDetails } = envelope.data.result;
	const problems: string[] = [];

	if (
		probe.expects === "syntaxError" ||
		probe.expects === "runtimeError" ||
		probe.expects === "figmaInternalError"
	) {
		if (exceptionDetails === undefined)
			return [
				`${probe.id}: se esperaba una excepción y Chrome devolvió un valor`,
			];
		const description = exceptionDetails.exception?.description ?? "";
		const stack = StackDescriptionSchema.safeParse(description);
		if (!stack.success)
			problems.push(...issues(`${probe.id} pila`, stack.error));
		if (probe.expects !== "figmaInternalError") {
			const className = exceptionDetails.exception?.className;
			if (className !== EXPECTED_CLASS[probe.expects]) {
				problems.push(
					`${probe.id}: className ${className} ≠ ${EXPECTED_CLASS[probe.expects]}`,
				);
			}
		}
		if (probe.expects !== "syntaxError" && !SCRIPT_FRAME.test(description)) {
			problems.push(
				`${probe.id}: la pila no trae el marco del script («<anonymous>:L:C»)`,
			);
		}
		if (probe.expects === "figmaInternalError") {
			const frames = description.split("\n").filter((l) => STACK_FRAME.test(l));
			if (!frames.some((f) => !f.includes("<anonymous>"))) {
				problems.push(
					`${probe.id}: se esperaban marcos de Figma además del del script`,
				);
			}
		}
		// Lo que importa al usuario: la línea que informa nuestro adaptador es la del script, no la de Figma
		const mapped = toScriptError(
			exceptionDetails,
			evaluation(probe).lineOffset,
		);
		if (mapped.type !== FIGMA_ERROR_TYPE.scriptError)
			problems.push(`${probe.id}: no es ScriptError`);
		else if (mapped.line !== markerLine(probe)) {
			problems.push(
				`${probe.id}: línea ${mapped.line} ≠ ${markerLine(probe)} (la del script)`,
			);
		}
		return problems;
	}

	if (exceptionDetails !== undefined) {
		return [
			`${probe.id}: Chrome devolvió una excepción: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
		];
	}
	const value = result.value;
	switch (probe.expects) {
		case "ready":
			if (value !== "object")
				problems.push(
					`ready: se esperaba "object" y llegó ${JSON.stringify(value)}`,
				);
			break;
		case "status": {
			const r = StatusValueSchema.safeParse(value);
			if (!r.success) problems.push(...issues("estado", r.error));
			break;
		}
		case "metadata": {
			const r = MetadataNodeSchema.safeParse(value);
			if (!r.success) problems.push(...issues("metadatos", r.error));
			break;
		}
		case "write": {
			const r = WriteResultSchema.safeParse(value);
			if (!r.success) problems.push(...issues("escritura", r.error));
			else if ((r.data.createdNodeIds ?? []).length !== 1)
				problems.push("escritura: se esperaba un id creado");
			break;
		}
		case "accessState": {
			const r = AccessStateSchema.safeParse(value);
			if (!r.success) problems.push(...issues("estado de acceso", r.error));
			break;
		}
		case "export": {
			const r = ExportValueSchema.safeParse(value);
			if (!r.success) problems.push(...issues("exportación PNG", r.error));
			break;
		}
		case "variables":
		case "styles":
		case "components":
		case "instances":
		case "exportNodes":
			problems.push(...readProblems(probe, value));
			break;
		case "paramsEcho": {
			const r = ParamsEchoSchema.safeParse(value);
			if (!r.success) {
				problems.push(...issues("params", r.error));
				break;
			}
			// El script devuelve lo que recibió: los params tal cual y la longitud en bytes del asset (Uint8Array)
			if (
				JSON.stringify(r.data.params) !== JSON.stringify(probe.params ?? {})
			) {
				problems.push(
					`params: el eco ${JSON.stringify(r.data.params)} no coincide con lo enviado`,
				);
			}
			const sentBytes = Object.values(probe.assets ?? {}).reduce(
				(sum, bytes) => sum + bytes.length,
				0,
			);
			if (r.data.assetLength !== sentBytes) {
				problems.push(
					`asset: longitud ${r.data.assetLength} ≠ ${sentBytes} (bytes enviados)`,
				);
			}
			break;
		}
	}
	return problems;
}
