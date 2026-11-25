import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildPng } from "../../../test/contracts/figma-values.ts";
import { extractImages } from "./images.ts";

const dataUrl = (type: string, bytes: Uint8Array) =>
	`data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;
// Un JPEG mínimo con su cabecera SOF0 (alto y ancho), lo que se lee para el tamaño
const buildJpg = (width: number, height: number): Uint8Array =>
	new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xe0,
		0x00,
		0x04,
		0x00,
		0x00,
		0xff,
		0xc0,
		0x00,
		0x11,
		0x08,
		height >> 8,
		height & 0xff,
		width >> 8,
		width & 0xff,
		0x03,
		0x01,
		0x22,
		0x00,
		0x02,
		0x11,
		0x01,
		0x03,
		0x11,
		0x01,
		0xff,
		0xd9,
	]);
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

describe("imágenes de una captura: de data: a ficheros por sha256", () => {
	it("cada img con data: pasa a ref (sha256 de los bytes) y sale una vez con su tamaño y tipo", () => {
		const png = buildPng(30, 20);
		const jpg = buildJpg(8, 6);
		const { nodes, images, warnings } = extractImages([
			{
				t: "frame",
				path: "main[0]",
				w: 1,
				h: 1,
				kids: [
					{
						t: "img",
						path: "main[0]/img[0]",
						data: dataUrl("png", png),
						w: 30,
						h: 20,
					},
					{
						t: "img",
						path: "main[0]/img[1]",
						data: dataUrl("png", png),
						w: 30,
						h: 20,
					},
					{
						t: "img",
						path: "main[0]/img[2]",
						data: dataUrl("jpeg", jpg),
						w: 8,
						h: 6,
					},
				],
			},
		]);
		const kids = (nodes[0] as { kids: Record<string, unknown>[] }).kids;
		assert.deepEqual(
			kids.map((k) => [k["ref"], "data" in k]),
			[
				[sha(png), false],
				[sha(png), false],
				[sha(jpg), false],
			],
		);
		assert.deepEqual(
			images.map((i) => [i.sha256, i.width, i.height, i.type]),
			[
				[sha(png), 30, 20, "png"],
				[sha(jpg), 8, 6, "jpeg"],
			],
		);
		assert.deepEqual(warnings, []);
	});

	it("una data: que no es PNG ni JPEG se queda sin ref y avisa con la ruta del nodo", () => {
		const { nodes, images, warnings } = extractImages([
			{
				t: "img",
				path: "img[0]",
				data: "data:image/gif;base64,R0lGOD",
				w: 1,
				h: 1,
			},
		]);
		assert.equal((nodes[0] as Record<string, unknown>)["ref"], undefined);
		assert.equal(images.length, 0);
		assert.match(warnings[0]?.message ?? "", /img\[0\]/);
	});
});
