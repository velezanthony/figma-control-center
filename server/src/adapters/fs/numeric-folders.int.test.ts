import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { numericFolders } from "./numeric-folders.ts";

let dir: string;
before(() => {
	dir = mkdtempSync(join(tmpdir(), "figma-numeric-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe("numericFolders", () => {
	it("devuelve los números de las carpetas que son un número y nada más", () => {
		for (const name of ["3", "12", "007", "9bd5-uuid", "chat-tokens", "1a"]) {
			mkdirSync(join(dir, name));
		}
		writeFileSync(join(dir, "8"), "un fichero, no una carpeta");
		assert.deepEqual(
			numericFolders(dir).sort((a, b) => a - b),
			[3, 12],
		);
	});

	it("una carpeta que no existe no es error: no hay restos", () => {
		assert.deepEqual(numericFolders(join(dir, "no-existe")), []);
	});
});
