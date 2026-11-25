import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { testEnv } from "./env.ts";

describe("testEnv", () => {
	it("todo lo que un proceso de prueba lee, escribe o MIGRA cuelga de la carpeta del entorno: ninguno toca el output/ real", () => {
		const dir = join("/tmp", "figma-e2e-prueba");
		const env = testEnv({
			dir,
			cdpPort: 1,
			scriptsRoot: join(dir, "scripts"),
			dashboardPort: 2,
			agentTerminal: "x",
		});
		for (const key of [
			"FCC_DB",
			"FCC_OUTPUT_DIR",
			"FCC_ACTIVITY_FILE",
			"FCC_LOCK_DIR",
			"FIGMA_CHROME_PROFILE",
			"FCC_WEB_CHROME_PROFILE_DIR",
			"FCC_WEB_SECRETS_FILE",
		]) {
			const value = env[key];
			assert.ok(value?.startsWith(`${dir}/`), `${key} = ${value}`);
		}
	});
});
