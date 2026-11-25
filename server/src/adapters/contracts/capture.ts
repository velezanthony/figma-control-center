// capture@1: lo que sale de capturar una pantalla. Contrato PROPIO (docs/users/contracts.md);
// JSON Schema publicado en schemas/capture.v1.json. El nodo lleva nombres cortos
// más `id` y `path`; las imágenes van por `ref`, nunca `data:`. La coherencia que
// el esquema no ve (ids únicos, refs que existen, tope de bytes) es de domain/capture-check.ts.
import { z } from "zod";
import {
	CAPTURE_KIT,
	CONTRACT,
	IMAGE_TYPES,
	NODE_TYPE,
	type ScreenCapture,
} from "#domain/capture.ts";
import { CAPTURE_ISSUE, type CaptureIssue } from "#domain/capture-check.ts";
import { NODE_ID_HEX } from "#domain/node-id.ts";

export const CAPTURE_CONTRACT = Object.freeze({
	name: "capture",
	version: 1,
} as const);

const SHA256 = /^[0-9a-f]{64}$/;
const NODE_ID = new RegExp(`^[0-9a-f]{${NODE_ID_HEX}}$`);
// Hora local con su desfase, como el resto de fechas que ve el agente
const LOCAL_ISO =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/;

const n = z.number();
const Rgba = z.tuple([n, n, n, n]);
const Box4 = z.tuple([n, n, n, n]);

const FontSchema = z.strictObject({
	fam: z.string(),
	size: n,
	weight: z.string(),
	lh: z.string(),
	ls: z.string(),
	tt: z.string(),
	td: z.string(),
	fs: z.string(),
	ta: z.string(),
	ws: z.string(),
	color: Rgba.nullable(),
});

const ShadowSchema = z.strictObject({
	c: Rgba,
	x: n,
	y: n,
	b: n,
	s: n,
	inset: z.boolean(),
});

const StopSchema = z.strictObject({ c: Rgba, p: n });

const GradientSchema = z.union([
	z.strictObject({ angle: n, stops: z.array(StopSchema) }),
	z.strictObject({ radial: z.literal(true), stops: z.array(StopSchema) }),
]);

const base = {
	id: z.string().regex(NODE_ID),
	path: z.string().min(1),
	tag: z.string().optional(),
	cls: z.string().optional(),
	x: n.optional(),
	y: n.optional(),
	w: n,
	h: n,
	pos: z.string().optional(),
	op: n.optional(),
	top: z.boolean().optional(),
};

const TextSchema = z.strictObject({
	...base,
	t: z.literal(NODE_TYPE.text),
	txt: z.string(),
	lines: n.optional(),
	font: FontSchema.optional(),
	ml: n.optional(),
	mr: n.optional(),
});

const SvgSchema = z.strictObject({
	...base,
	t: z.literal(NODE_TYPE.svg),
	svg: z.string(),
	key: z.string().optional(),
	color: Rgba.nullable().optional(),
	spin: z.boolean().optional(),
});

const ImgSchema = z.strictObject({
	...base,
	t: z.literal(NODE_TYPE.img),
	ref: z.string().regex(SHA256),
	src: z.string().optional(),
	fit: z.string().optional(),
	rad: Box4.optional(),
	glyph: z.string().optional(),
});

const IconSchema = z.strictObject({
	...base,
	t: z.literal(NODE_TYPE.icon),
	name: z.string(),
	color: Rgba.nullable().optional(),
});

const FrameSchema = z.strictObject({
	...base,
	t: z.literal(NODE_TYPE.frame),
	disp: z.string().optional(),
	dir: z.string().optional(),
	wrap: z.string().optional(),
	jc: z.string().optional(),
	ai: z.string().optional(),
	gap: n.optional(),
	rgap: n.optional(),
	pad: Box4.optional(),
	bg: Rgba.nullable().optional(),
	bw: Box4.optional(),
	bc: Rgba.nullable().optional(),
	bcb: Rgba.nullable().optional(),
	rad: Box4.optional(),
	sh: z.string().optional(),
	shs: z.array(ShadowSchema).optional(),
	fl: z.string().optional(),
	ov: z.string().optional(),
	ml: n.optional(),
	font: FontSchema.optional(),
	va: z.string().optional(),
	grad: GradientSchema.nullable().optional(),
	fg: n.optional(),
	get kids() {
		return z.array(NodeSchema);
	},
});

export const NodeSchema: z.ZodType<
	ScreenCapture["variants"][number]["nodes"][number]
> = z.discriminatedUnion("t", [
	FrameSchema,
	TextSchema,
	SvgSchema,
	ImgSchema,
	IconSchema,
]);

const ImageSchema = z.strictObject({
	path: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	type: z.enum(IMAGE_TYPES),
});

export const CaptureSchema = z.strictObject({
	contract: z.literal(CONTRACT.capture),
	screen: z.string().min(1),
	title: z.string().min(1),
	source: z.strictObject({
		url: z.url(),
		viewport: z.strictObject({
			w: z.number().int().positive(),
			h: z.number().int().positive(),
		}),
		screenScale: z.number().positive(),
		devicePixelRatio: z.number().positive(),
		capturedAt: z.string().regex(LOCAL_ISO),
		kit: z.literal(CAPTURE_KIT),
		hooks: z.strictObject({ sha256: z.string().regex(SHA256) }).nullable(),
	}),
	variants: z.array(
		z.strictObject({
			props: z.record(z.string(), z.string()),
			nodes: z.array(NodeSchema),
			annotations: z.tuple([]),
		}),
	),
	images: z.record(z.string().regex(SHA256), ImageSchema),
	warnings: z.array(
		z.strictObject({ nodeId: z.string().optional(), message: z.string() }),
	),
}) satisfies z.ZodType<ScreenCapture>; // el tipo del dominio y el esquema no pueden divergir

const NODE_LISTS = new Set(["nodes", "kids"]);

// El nodo más interno del camino de un problema (lo que cuelga de `nodes` o `kids`), para dar su id y su ruta
function nodeAt(
	value: unknown,
	path: readonly PropertyKey[],
): { readonly id?: string; readonly path?: string } | null {
	let current: unknown = value;
	let found: { readonly id?: string; readonly path?: string } | null = null;
	for (const [i, key] of path.entries()) {
		if (current === null || typeof current !== "object") break;
		current = (current as Record<PropertyKey, unknown>)[key];
		const parent = path[i - 1];
		if (
			typeof key === "number" &&
			typeof parent === "string" &&
			NODE_LISTS.has(parent)
		) {
			const n = current as { id?: unknown; path?: unknown } | null;
			if (n !== null && typeof n === "object")
				found = {
					...(typeof n.id === "string" && { id: n.id }),
					...(typeof n.path === "string" && { path: n.path }),
				};
		}
	}
	return found;
}

// Lo que dice capture@1 de una captura, como problemas con el id y la ruta del nodo donde están (si están en uno)
export function captureSchemaIssues(value: unknown): CaptureIssue[] {
	const parsed = CaptureSchema.safeParse(value);
	if (parsed.success) return [];
	return parsed.error.issues.map((issue) => {
		const node = nodeAt(value, issue.path);
		const keys =
			"keys" in issue && Array.isArray(issue.keys)
				? ` (${issue.keys.join(", ")})`
				: "";
		const where =
			node === null
				? `\`${issue.path.map(String).join(".")}\``
				: `nodo ${node.id ?? "?"} \`${node.path ?? "?"}\``;
		return {
			code: CAPTURE_ISSUE.schema,
			message: `${where}: ${issue.message}${keys}`,
			...(node?.id !== undefined && { nodeId: node.id }),
			...(node?.path !== undefined && { path: node.path }),
		};
	});
}
