// E60 límites: un clic que navega fuera de baseUrl es WebPageError (navigation); sin
// proyecto, el error de uso de siempre; dos capturas a la vez, la segunda ocupada; al acabar no queda el proceso ni el
// perfil, y el Chrome de Figma (el simulador) no recibe nada.
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

let c: CaptureEnvironment | undefined;
afterEach(async () => {
	await c?.stop();
	c = undefined;
});

// Procesos vivos cuya orden lleva esta ruta (un Chrome que se quedó con su perfil)
const processesWith = (text: string): number[] =>
	readdirSync("/proc")
		.filter((p) => /^\d+$/.test(p))
		.filter((p) => {
			try {
				return readFileSync(`/proc/${p}/cmdline`, "utf8").includes(text);
			} catch {
				return false;
			}
		})
		.map(Number);

describe("E60 · límites", () => {
	it("un clic que sale de baseUrl es WebPageError (navigation) y no se sigue", async () => {
		c = await startCaptureEnvironment();
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["salir"],
		});
		assert.equal(r.isError, true);
		const error = r.out["error"] as {
			type: string;
			reason: string;
			message: string;
		};
		assert.deepEqual(
			[error.type, error.reason],
			["WebPageError", "navigation"],
		);
		assert.match(error.message, /fuera\.invalid/);
	});

	it("sin proyecto, el error de uso de siempre", async () => {
		c = await startCaptureEnvironment({ noProject: true });
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["inicio"],
		});
		assert.equal(r.isError, true);
		assert.match(r.text, /^No hay ningún proyecto\./);
	});

	it("dos capturas a la vez: la segunda, ocupada; al acabar no queda proceso ni perfil y el Chrome de Figma no se usa", async () => {
		c = await startCaptureEnvironment();
		const figmaBefore = c.env.simulator?.expressions.length ?? 0;
		const [a, b] = await Promise.all([
			c.claude.callTool(TOOL_NAME.capture, {
				screens: ["inicio", "menu-abierto"],
			}),
			new Promise((r) => setTimeout(r, 150)).then(() =>
				c?.claude.callTool(TOOL_NAME.capture, { screens: ["inicio"] }),
			),
		]);
		assert.equal(a.isError, false, a.text);
		assert.equal(b?.isError, true);
		assert.match(b?.text ?? "", /otra captura de la web/);
		const profiles = join(c.env.dir, PROFILES_DIR);
		assert.deepEqual(existsSync(profiles) ? readdirSync(profiles) : [], []);
		assert.deepEqual(processesWith(profiles), []);
		assert.equal(c.env.simulator?.expressions.length ?? 0, figmaBefore);
	});
});
