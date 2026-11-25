import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NODE_ID_HEX, nodeId, sha256Hex, withIds } from "./node-id.ts";

describe("sha256 puro", () => {
	it("da los vectores conocidos («» y «abc»)", () => {
		assert.equal(
			sha256Hex(""),
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		assert.equal(
			sha256Hex("abc"),
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("codifica en UTF-8 lo que no es ASCII", () => {
		assert.equal(
			sha256Hex("ñandú/€"),
			"aa73a8b6b8a4f321c72b9d21e47695d683c14ecaaeb49e51b61bd2c7635b4582",
		);
	});

	it("un texto de más de un bloque (64 bytes) también", () => {
		assert.equal(
			sha256Hex("a".repeat(130)),
			"1e3c4f4750c8c29bbfa9ced317788176b156d342e57f7777f62fd7221a44312f",
		);
	});
});

describe("id de nodo", () => {
	it("son los primeros 8 hexadecimales del sha256 de la ruta", () => {
		assert.equal(NODE_ID_HEX, 8);
		assert.equal(nodeId("main[0]/div[2]/button[0]"), "6c272821");
		assert.equal(nodeId("header[0]/#text[0]"), "a0b7d3a4");
	});

	it("la misma ruta da siempre el mismo id y otra ruta otro", () => {
		assert.equal(nodeId("main[0]"), nodeId("main[0]"));
		assert.notEqual(nodeId("main[0]"), nodeId("main[1]"));
	});
});

describe("ids de un árbol capturado", () => {
	it("cada nodo con ruta recibe el id de su ruta, también los anidados; lo demás no cambia", () => {
		const tree = withIds([
			{
				t: "frame",
				path: "main[0]",
				w: 1,
				h: 1,
				kids: [{ t: "text", path: "main[0]/#text[0]", w: 1, h: 1 }],
			},
		]);
		assert.deepEqual(tree, [
			{
				t: "frame",
				id: nodeId("main[0]"),
				path: "main[0]",
				w: 1,
				h: 1,
				kids: [
					{
						t: "text",
						id: nodeId("main[0]/#text[0]"),
						path: "main[0]/#text[0]",
						w: 1,
						h: 1,
					},
				],
			},
		]);
	});
});
