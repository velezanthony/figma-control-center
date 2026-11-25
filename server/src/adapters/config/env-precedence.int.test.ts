// Fija el comportamiento comprobado en Node 24 del que depende el arnés: `process.loadEnvFile`
// NO pisa una variable ya puesta en el entorno, así que un FCC_PROJECTS del .env no anula el del lanzamiento
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("process.loadEnvFile y el entorno", () => {
	it("FCC_PROJECTS del entorno gana al de un fichero cargado con loadEnvFile", () => {
		const dir = mkdtempSync(join(tmpdir(), "figma-loadenv-"));
		try {
			const file = join(dir, "fichero.env");
			writeFileSync(file, "FCC_PROJECTS=2\nSOLO_EN_FICHERO=si\n");
			const r = spawnSync(
				process.execPath,
				[
					"-e",
					"process.loadEnvFile(process.argv[1]); process.stdout.write(JSON.stringify([process.env.FCC_PROJECTS, process.env.SOLO_EN_FICHERO]))",
					file,
				],
				{
					env: { PATH: process.env["PATH"] ?? "", FCC_PROJECTS: "1" },
					encoding: "utf8",
				},
			);
			assert.equal(r.status, 0, r.stderr);
			assert.deepEqual(JSON.parse(r.stdout), ["1", "si"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
