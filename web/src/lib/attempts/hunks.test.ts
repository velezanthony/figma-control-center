import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { DiffHunk } from "#web/lib/contract.ts";
import { contentHunk, hunkTitle, nextHunk } from "./hunks.ts";

const hunk = (oldStart: number, newStart: number, lines: number): DiffHunk => ({
	oldStart,
	oldLines: lines,
	newStart,
	newLines: lines,
	lines: Array.from({ length: lines }, (_, i) => ({
		op: "context" as const,
		oldNo: oldStart + i,
		newNo: newStart + i,
		text: `l${i}`,
	})),
});

describe("navegación entre bloques del diff (n y p)", () => {
	it("n salta al siguiente y p al anterior; en los extremos se queda", () => {
		assert.equal(nextHunk(-1, 3, "n"), 0, "sin foco, n va al primero");
		assert.equal(nextHunk(0, 3, "n"), 1);
		assert.equal(nextHunk(2, 3, "n"), 2);
		assert.equal(nextHunk(2, 3, "p"), 1);
		assert.equal(nextHunk(0, 3, "p"), 0);
		assert.equal(nextHunk(-1, 3, "p"), 2, "sin foco, p va al último");
	});

	it("sin bloques no hay a dónde ir", () => {
		assert.equal(nextHunk(-1, 0, "n"), null);
	});

	it("otra tecla no navega", () => {
		assert.equal(nextHunk(0, 3, "x"), null);
	});
});

describe("título de un bloque", () => {
	it("«cambio 2 de 5, líneas 40 a 52», con los números del lado nuevo", () => {
		assert.equal(
			hunkTitle(hunk(38, 40, 13), 1, 5),
			"cambio 2 de 5, líneas 40 a 52",
		);
	});

	it("un bloque de una sola línea dice «línea N»", () => {
		assert.equal(hunkTitle(hunk(7, 7, 1), 0, 1), "cambio 1 de 1, línea 7");
	});

	it("un bloque todo borrado usa los números del lado viejo", () => {
		const removed: DiffHunk = {
			oldStart: 3,
			oldLines: 2,
			newStart: 2,
			newLines: 0,
			lines: [
				{ op: "del", oldNo: 3, newNo: null, text: "a" },
				{ op: "del", oldNo: 4, newNo: null, text: "b" },
			],
		};
		assert.equal(
			hunkTitle(removed, 0, 1),
			"cambio 1 de 1, líneas 3 a 4 (borradas)",
		);
	});
});

describe("contenido de un papel como un bloque de contexto", () => {
	it("cada línea numerada desde 1, sin salto final fantasma", () => {
		const h = contentHunk("a\nb\n");
		assert.deepEqual(
			h.lines.map((l) => [l.op, l.oldNo, l.newNo, l.text]),
			[
				["context", 1, 1, "a"],
				["context", 2, 2, "b"],
			],
		);
		assert.equal(h.newLines, 2);
	});

	it("un contenido vacío no tiene líneas", () => {
		assert.deepEqual(contentHunk("").lines, []);
	});

	it("\\r\\n cuenta como un solo salto", () => {
		assert.equal(contentHunk("a\r\nb").lines.length, 2);
	});
});
