import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	canonicalJson,
	type DiffHunk,
	diffLines,
	limitHunks,
	limitText,
	toUnifiedDiff,
} from "./text-diff.ts";

const hunks = (a: string, b: string, options = {}): readonly DiffHunk[] => {
	const outcome = diffLines(a, b, options);
	assert.equal(outcome.kind, "diff");
	return outcome.kind === "diff" ? outcome.hunks : [];
};

const ops = (hunk: DiffHunk | undefined) =>
	(hunk?.lines ?? []).map((l) => `${l.op[0]}:${l.text}`);

describe("diff de líneas", () => {
	it("dos textos iguales: sin bloques y sin cambios", () => {
		const outcome = diffLines("a\nb\nc\n", "a\nb\nc\n");
		assert.deepEqual(outcome, {
			kind: "diff",
			hunks: [],
			added: 0,
			removed: 0,
		});
	});

	it("vacío contra algo: todo son líneas añadidas, numeradas del lado nuevo", () => {
		const [hunk] = hunks("", "x\ny\n");
		assert.deepEqual(ops(hunk), ["a:x", "a:y"]);
		assert.deepEqual(
			hunk?.lines.map((l) => [l.oldNo, l.newNo]),
			[
				[null, 1],
				[null, 2],
			],
		);
		assert.equal(hunk?.newStart, 1);
		assert.equal(hunk?.newLines, 2);
		assert.equal(hunk?.oldLines, 0);
	});

	it("algo contra vacío: todo son líneas borradas", () => {
		const outcome = diffLines("x\ny\n", "");
		assert.equal(outcome.kind === "diff" && outcome.removed, 2);
		assert.equal(outcome.kind === "diff" && outcome.added, 0);
	});

	it("insertar una línea en medio deja contexto a los dos lados", () => {
		const [hunk] = hunks("a\nb\nc\n", "a\nb\nNEW\nc\n");
		assert.deepEqual(ops(hunk), ["c:a", "c:b", "a:NEW", "c:c"]);
	});

	it("borrar una línea", () => {
		const [hunk] = hunks("a\nb\nc\n", "a\nc\n");
		assert.deepEqual(ops(hunk), ["c:a", "d:b", "c:c"]);
	});

	it("cambiar una línea: sale borrada y añadida, con los dos números", () => {
		const [hunk] = hunks("a\nb\nc\n", "a\nB\nc\n");
		assert.deepEqual(ops(hunk), ["c:a", "d:b", "a:B", "c:c"]);
		const del = hunk?.lines.find((l) => l.op === "del");
		const add = hunk?.lines.find((l) => l.op === "add");
		assert.deepEqual([del?.oldNo, del?.newNo], [2, null]);
		assert.deepEqual([add?.oldNo, add?.newNo], [null, 2]);
	});

	it("solo 3 líneas de contexto por defecto", () => {
		const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
		const b = a.replace("l10", "X10");
		const [hunk] = hunks(a, b);
		assert.equal(hunk?.lines.length, 3 + 2 + 3);
		assert.equal(hunk?.oldStart, 8);
		assert.equal(hunk?.newStart, 8);
	});

	it("dos cambios lejanos son dos bloques; cercanos se unen", () => {
		const a = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
		const far = a.replace("l2\n", "X2\n").replace("l25\n", "X25\n");
		assert.equal(hunks(a, far).length, 2);
		const near = a.replace("l10\n", "X10\n").replace("l14\n", "X14\n");
		assert.equal(hunks(a, near).length, 1);
	});

	it("el contexto se puede pedir de otro tamaño", () => {
		const [hunk] = hunks("a\nb\nc\nd\ne\n", "a\nb\nX\nd\ne\n", { context: 1 });
		assert.deepEqual(ops(hunk), ["c:b", "d:c", "a:X", "c:d"]);
	});

	it("\\r\\n y \\n valen lo mismo", () => {
		const outcome = diffLines("a\r\nb\r\n", "a\nb\n");
		assert.equal(outcome.kind === "diff" && outcome.hunks.length, 0);
	});

	it("falta el salto de línea final: es un cambio y se marca", () => {
		const [hunk] = hunks("a\nb", "a\nb\n");
		assert.deepEqual(ops(hunk), ["c:a", "d:b", "a:b"]);
		assert.equal(hunk?.lines.find((l) => l.op === "del")?.noEol, true);
		assert.notEqual(hunk?.lines.find((l) => l.op === "add")?.noEol, true);
	});

	it("cuenta las líneas añadidas y borradas", () => {
		const outcome = diffLines("a\nb\nc\n", "a\nX\nY\nc\n");
		assert.equal(outcome.kind === "diff" && outcome.added, 2);
		assert.equal(outcome.kind === "diff" && outcome.removed, 1);
	});

	it("textos completamente distintos: tantas borradas como líneas viejas", () => {
		const a = Array.from({ length: 50 }, (_, i) => `a${i}`).join("\n");
		const b = Array.from({ length: 40 }, (_, i) => `b${i}`).join("\n");
		const outcome = diffLines(a, b);
		assert.equal(outcome.kind === "diff" && outcome.removed, 50);
		assert.equal(outcome.kind === "diff" && outcome.added, 40);
	});

	it("reconstruye el texto nuevo aplicando el diff a un texto largo", () => {
		const a = Array.from({ length: 200 }, (_, i) => `línea ${i}`);
		const b = a.filter((_, i) => i % 7 !== 0);
		b.splice(30, 0, "nueva 1", "nueva 2");
		b[90] = "cambiada";
		const outcome = diffLines(a.join("\n"), b.join("\n"), { context: 1000 });
		assert.equal(outcome.kind, "diff");
		if (outcome.kind !== "diff") return;
		const rebuilt = outcome.hunks
			.flatMap((h) => h.lines)
			.filter((l) => l.op !== "del")
			.map((l) => l.text);
		assert.deepEqual(rebuilt, b);
	});

	it("pasado el tope de cambios, para y dice que es demasiado grande", () => {
		const a = Array.from({ length: 100 }, (_, i) => `a${i}`).join("\n");
		const b = Array.from({ length: 100 }, (_, i) => `b${i}`).join("\n");
		assert.deepEqual(diffLines(a, b, { maxEdits: 50 }), { kind: "too_large" });
		assert.equal(diffLines(a, b, { maxEdits: 200 }).kind, "diff");
	});
});

describe("diff unificado en texto", () => {
	it("cabeceras de bloque, signos y aviso de falta de salto final", () => {
		const text = toUnifiedDiff(hunks("a\nb", "a\nB\n"));
		assert.equal(
			text,
			[
				"@@ -1,2 +1,2 @@",
				" a",
				"-b",
				"\\ No newline at end of file",
				"+B",
				"",
			].join("\n"),
		);
	});

	it("sin bloques: texto vacío", () => {
		assert.equal(toUnifiedDiff([]), "");
	});
});

describe("JSON canónico para comparar", () => {
	it("formatea con sangría de 2 espacios", () => {
		assert.equal(canonicalJson('{"a":1}'), '{\n  "a": 1\n}');
	});

	it("ordena las claves de cada objeto, también los anidados, no los arrays", () => {
		assert.equal(
			canonicalJson('{"b":{"z":1,"y":2},"a":[{"d":1,"c":2},3]}'),
			JSON.stringify({ a: [{ c: 2, d: 1 }, 3], b: { y: 2, z: 1 } }, null, 2),
		);
	});

	it("dos JSON con las mismas claves en otro orden dan el mismo texto", () => {
		assert.equal(
			canonicalJson('{"x":1,"y":2}'),
			canonicalJson('{"y":2,"x":1}'),
		);
	});

	it("si no es JSON válido, lo devuelve tal cual", () => {
		assert.equal(canonicalJson("no { es json"), "no { es json");
	});
});

describe("recortes", () => {
	const long = Array.from({ length: 40 }, (_, i) => `a${i}`).join("\n");
	const other = Array.from({ length: 40 }, (_, i) => `b${i}`).join("\n");

	it("limitHunks deja como mucho N líneas en total y dice que recortó", () => {
		const all = hunks(long, other, { maxEdits: 1000 });
		const out = limitHunks(all, 30);
		assert.equal(out.truncated, true);
		assert.equal(
			out.hunks.reduce((n, h) => n + h.lines.length, 0),
			30,
		);
	});

	it("un bloque recortado ajusta su cuenta de líneas a lo que lleva", () => {
		const [cut] = limitHunks(hunks(long, other, { maxEdits: 1000 }), 5).hunks;
		assert.equal(cut?.lines.length, 5);
		assert.equal(
			(cut?.oldLines ?? 0) + (cut?.newLines ?? 0),
			5,
			"cada línea cuenta en un solo lado",
		);
	});

	it("si cabe, no toca nada", () => {
		const all = hunks("a\nb\n", "a\nB\n");
		assert.deepEqual(limitHunks(all, 100), { hunks: all, truncated: false });
	});

	it("limitText corta por líneas, cuenta las totales y dice que recortó", () => {
		assert.deepEqual(limitText("a\nb\nc\n", 2), {
			content: "a\nb\n",
			lines: 3,
			truncated: true,
		});
		assert.deepEqual(limitText("a\nb", 5), {
			content: "a\nb",
			lines: 2,
			truncated: false,
		});
		assert.deepEqual(limitText("", 5), {
			content: "",
			lines: 0,
			truncated: false,
		});
	});
});
