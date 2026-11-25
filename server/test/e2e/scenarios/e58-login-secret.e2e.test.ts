// E58 login y secreto: una pantalla con `session` entra por el formulario real; con
// una contraseña mala es WebPageError (login); un secretRef sin valor es SecretMissing sin lanzar Chrome; el secreto no
// aparece en la base, en los ficheros de salida ni en la respuesta (se busca en los bytes).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type CaptureEnvironment,
	PROFILES_DIR,
	startCaptureEnvironment,
} from "../../harness/capture-environment.ts";
import {
	EXAMPLE_MINI_PASSWORD,
	EXAMPLE_MINI_SECRET_REF,
} from "../../harness/example-mini.ts";

let c: CaptureEnvironment | undefined;
afterEach(async () => {
	await c?.stop();
	c = undefined;
});

const allFiles = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir, { recursive: true, withFileTypes: true })
				.filter((e) => e.isFile())
				.map((e) => join(e.parentPath, e.name))
		: [];

describe("E58 · login y secreto", () => {
	it("una pantalla con sesión entra por el formulario y captura la página privada", async () => {
		c = await startCaptureEnvironment();
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["privado"],
		});
		assert.equal(r.isError, false, r.text);
		const path = (r.out["files"] as { path: string }[])[0]?.path ?? "";
		assert.match(readFileSync(path, "utf8"), /Zona privada/);
	});

	it("el secreto no está en la base, los ficheros de salida ni la respuesta", async () => {
		c = await startCaptureEnvironment();
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["privado", "inicio"],
		});
		assert.equal(r.isError, false, r.text);
		assert.equal(r.text.includes(EXAMPLE_MINI_PASSWORD), false, "respuesta");
		const files = [
			...allFiles(join(c.env.dir, "salida")),
			...allFiles(c.env.dir).filter((f) => f.includes("figma.db")),
		];
		assert.ok(files.length > 0);
		for (const f of files)
			assert.equal(readFileSync(f).includes(EXAMPLE_MINI_PASSWORD), false, f);
	});

	it("con una contraseña mala es WebPageError con motivo login", async () => {
		c = await startCaptureEnvironment({
			secrets: { [EXAMPLE_MINI_SECRET_REF]: "mala" },
		});
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["privado"],
		});
		assert.equal(r.isError, true);
		const error = r.out["error"] as { type: string; reason: string };
		assert.deepEqual([error.type, error.reason], ["WebPageError", "login"]);
	});

	it("un secretRef sin valor es SecretMissing y no se lanza Chrome", async () => {
		c = await startCaptureEnvironment({ secrets: {} });
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["privado"],
		});
		assert.equal(r.isError, true);
		const error = r.out["error"] as { type: string; secretRef: string };
		assert.deepEqual(
			[error.type, error.secretRef],
			["SecretMissing", EXAMPLE_MINI_SECRET_REF],
		);
		assert.equal(r.out["jobId"], null);
		// Ni siquiera se creó la carpeta de perfiles: Chrome no llegó a lanzarse
		assert.equal(existsSync(join(c.env.dir, PROFILES_DIR)), false);
	});
});
