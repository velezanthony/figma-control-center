import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CAPTURE_KIT,
	type CaptureNode,
	CONTRACT,
	type ScreenCapture,
} from "./capture.ts";
import { CAPTURE_ISSUE, checkCapture } from "./capture-check.ts";

const text = (id: string, path: string): CaptureNode => ({
	t: "text",
	id,
	path,
	txt: "Hola",
	x: 0,
	y: 0,
	w: 30,
	h: 18,
});

const capture = (
	nodes: readonly CaptureNode[],
	images: ScreenCapture["images"] = {},
): ScreenCapture => ({
	contract: CONTRACT.capture,
	screen: "inicio",
	title: "Inicio",
	source: {
		url: "http://127.0.0.1:1/",
		viewport: { w: 800, h: 600 },
		screenScale: 1,
		devicePixelRatio: 1,
		capturedAt: "2026-11-11T10:00:00",
		kit: CAPTURE_KIT,
		hooks: null,
	},
	variants: [{ props: {}, nodes, annotations: [] }],
	images,
	warnings: [],
});

const frame = (
	id: string,
	path: string,
	kids: readonly CaptureNode[],
): CaptureNode => ({ t: "frame", id, path, w: 100, h: 50, kids });

const BIG = 1_000_000;

describe("comprobación de una captura antes de guardarla", () => {
	it("una captura coherente no da ningún problema", () => {
		const ok = capture([
			frame("aaaaaaaa", "main[0]", [text("bbbbbbbb", "main[0]/#text[0]")]),
		]);
		assert.deepEqual(checkCapture(ok, { bytes: 10, maxBytes: BIG }), []);
	});

	it("dos nodos con el mismo id en una variante: problema con el id y las dos rutas", () => {
		const dup = capture([text("aaaaaaaa", "p[0]"), text("aaaaaaaa", "p[1]")]);
		const issues = checkCapture(dup, { bytes: 10, maxBytes: BIG });
		assert.deepEqual(
			issues.map((i) => [i.code, i.nodeId, i.path]),
			[[CAPTURE_ISSUE.duplicateId, "aaaaaaaa", "p[1]"]],
		);
		assert.match(issues[0]?.message ?? "", /p\[0\]/);
	});

	it("un nodo que no es marco con hijos es un problema", () => {
		const bad = {
			...text("aaaaaaaa", "span[0]"),
			kids: [text("bbbbbbbb", "span[0]/#text[0]")],
		} as unknown as CaptureNode;
		const issues = checkCapture(capture([bad]), { bytes: 10, maxBytes: BIG });
		assert.deepEqual(
			issues.map((i) => [i.code, i.nodeId]),
			[[CAPTURE_ISSUE.kidsOutsideFrame, "aaaaaaaa"]],
		);
	});

	it("una caja negativa o sin ancho es un problema con id y ruta", () => {
		const negative = { ...text("aaaaaaaa", "p[0]"), h: -1 };
		const { w: _w, ...noWidth } = text("bbbbbbbb", "p[1]");
		const issues = checkCapture(
			capture([negative, noWidth as unknown as CaptureNode]),
			{ bytes: 10, maxBytes: BIG },
		);
		assert.deepEqual(
			issues.map((i) => [i.code, i.nodeId, i.path]),
			[
				[CAPTURE_ISSUE.badBox, "aaaaaaaa", "p[0]"],
				[CAPTURE_ISSUE.badBox, "bbbbbbbb", "p[1]"],
			],
		);
		assert.match(issues[1]?.message ?? "", /falta `w`/);
	});

	it("una imagen cuyo ref no está en images es un problema", () => {
		const img: CaptureNode = {
			t: "img",
			id: "aaaaaaaa",
			path: "img[0]",
			ref: "f".repeat(64),
			w: 10,
			h: 10,
		};
		const issues = checkCapture(capture([img]), { bytes: 10, maxBytes: BIG });
		assert.deepEqual(
			issues.map((i) => i.code),
			[CAPTURE_ISSUE.missingImage],
		);
		const fine = capture([img], {
			["f".repeat(64)]: {
				path: "img/x.png",
				width: 10,
				height: 10,
				type: "png",
			},
		});
		assert.deepEqual(checkCapture(fine, { bytes: 10, maxBytes: BIG }), []);
	});

	it("una captura que supera el tope de bytes es un problema que da los dos tamaños", () => {
		const issues = checkCapture(capture([]), { bytes: 501, maxBytes: 500 });
		assert.deepEqual(
			issues.map((i) => i.code),
			[CAPTURE_ISSUE.tooLarge],
		);
		assert.match(issues[0]?.message ?? "", /501.*500/);
	});

	it("revisa los nodos anidados", () => {
		const deep = capture([
			frame("aaaaaaaa", "main[0]", [
				frame("bbbbbbbb", "main[0]/div[0]", [
					text("aaaaaaaa", "main[0]/div[0]/#text[0]"),
				]),
			]),
		]);
		assert.deepEqual(
			checkCapture(deep, { bytes: 10, maxBytes: BIG }).map((i) => i.path),
			["main[0]/div[0]/#text[0]"],
		);
	});
});
