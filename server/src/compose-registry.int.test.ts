import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { openRegistry } from "./compose-registry.ts";

let dir: string;
before(() => {
	dir = mkdtempSync(join(tmpdir(), "figma-registry-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const draft = {
	name: "A",
	projectDir: "/p",
	fileUrl: "https://www.figma.com/design/AAA/A",
} as const;

describe("openRegistry", () => {
	it("abre la base única y da de alta con el número siguiente, sin chocar con las carpetas numéricas de la salida", async () => {
		const outputDir = join(dir, "salida");
		mkdirSync(join(outputDir, "4"), { recursive: true });
		const registry = openRegistry({
			dbPath: join(dir, "ok", "figma.db"),
			outputRoot: outputDir,
			outputDirFor: (id) => join(outputDir, id),
		});
		const added = await registry.add(draft);
		assert.ok(added.ok);
		assert.equal(added.value.id, "5");
		assert.equal(added.value.outputDir, join(outputDir, "5"));
	});

	it("si la base no se puede abrir (no es una base SQLite), no tumba el arranque: lee como error con la ruta y no deja escribir", async () => {
		const broken = join(dir, "rota.db");
		writeFileSync(broken, "esto no es una base SQLite, ni de lejos");
		const registry = openRegistry({
			dbPath: broken,
			outputRoot: dir,
			outputDirFor: (id) => join(dir, id),
		});
		const read = await registry.read();
		assert.ok(!read.ok);
		assert.equal(read.error.reason, "unreadable");
		assert.ok(read.error.message.includes(broken));
		const add = await registry.add(draft);
		assert.ok(!add.ok);
		assert.ok(add.error.message.includes(broken));
	});
});
