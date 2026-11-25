// Coherencia de una captura antes de guardarla: lo que el esquema estricto no ve. Ids
// únicos por variante, `kids` solo en marcos, cajas con `w`/`h` ≥ 0, todo `ref` en `images` y el tope de bytes. Puro:
// el tamaño en bytes lo calcula quien llama (el JSON tal como se va a guardar).
import { type CaptureNode, NODE_TYPE, type ScreenCapture } from "./capture.ts";

export const CAPTURE_ISSUE = Object.freeze({
	duplicateId: "duplicateId",
	kidsOutsideFrame: "kidsOutsideFrame",
	badBox: "badBox",
	missingImage: "missingImage",
	tooLarge: "tooLarge",
	// Lo que dice el esquema zod de capture@1 (lo añade quien valida en el borde)
	schema: "schema",
} as const);

export type CaptureIssueCode =
	(typeof CAPTURE_ISSUE)[keyof typeof CAPTURE_ISSUE];

export type CaptureIssue = {
	readonly code: CaptureIssueCode;
	readonly message: string;
	readonly nodeId?: string | undefined;
	readonly path?: string | undefined;
};

type Limits = { readonly bytes: number; readonly maxBytes: number };

const where = (node: CaptureNode): string => `nodo ${node.id} \`${node.path}\``;

function boxProblem(node: CaptureNode): string | null {
	for (const side of ["w", "h"] as const) {
		const value: unknown = node[side];
		if (typeof value !== "number" || Number.isNaN(value))
			return `falta \`${side}\``;
		if (value < 0) return `\`${side}\` negativo (${value})`;
	}
	return null;
}

export function checkCapture(
	capture: ScreenCapture,
	limits: Limits,
): CaptureIssue[] {
	const issues: CaptureIssue[] = [];
	const issue = (
		code: CaptureIssueCode,
		node: CaptureNode,
		detail: string,
	): void => {
		issues.push({
			code,
			message: `${where(node)}: ${detail}`,
			nodeId: node.id,
			path: node.path,
		});
	};
	for (const variant of capture.variants) {
		const seen = new Map<string, string>();
		const visit = (node: CaptureNode): void => {
			const first = seen.get(node.id);
			if (first === undefined) seen.set(node.id, node.path);
			else
				issue(
					CAPTURE_ISSUE.duplicateId,
					node,
					`id repetido (ya lo usa \`${first}\`)`,
				);
			const box = boxProblem(node);
			if (box !== null) issue(CAPTURE_ISSUE.badBox, node, box);
			if (node.t === NODE_TYPE.img && capture.images[node.ref] === undefined)
				issue(
					CAPTURE_ISSUE.missingImage,
					node,
					`la imagen ${node.ref} no está en \`images\``,
				);
			const kids = (node as { readonly kids?: readonly CaptureNode[] }).kids;
			if (kids === undefined) return;
			if (node.t !== NODE_TYPE.frame)
				issue(
					CAPTURE_ISSUE.kidsOutsideFrame,
					node,
					`un nodo \`${node.t}\` no puede tener \`kids\``,
				);
			for (const kid of kids) visit(kid);
		};
		for (const node of variant.nodes) visit(node);
	}
	if (limits.bytes > limits.maxBytes)
		issues.push({
			code: CAPTURE_ISSUE.tooLarge,
			message: `la captura ocupa ${limits.bytes} bytes, más que el tope de ${limits.maxBytes} (FCC_CAPTURE_MAX_BYTES)`,
		});
	return issues;
}
