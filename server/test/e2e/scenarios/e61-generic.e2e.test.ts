// E61 genérico: example-mini se captura entero sin ningún dato de una web real; su HTML
// no lleva ningún data-* (nunca se tocan los componentes del proyecto). El test de P1 (nombres de web en server/src y
// kits/) vive en server/test/architecture.test.ts.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type CaptureEnvironment,
	startCaptureEnvironment,
} from "../../harness/capture-environment.ts";
import { EXAMPLE_MINI_DIR } from "../../harness/example-mini.ts";

const WEB_HOOKS = /djDebug|x-data|x-cloak|alpine|csrfmiddlewaretoken|toast/i;

let c: CaptureEnvironment;
before(async () => {
	c = await startCaptureEnvironment();
});
after(async () => {
	await c?.stop();
});

describe("E61 · genérico", () => {
	it("example-mini no tiene data-* ni nada de una web real", () => {
		const files = readdirSync(EXAMPLE_MINI_DIR, {
			recursive: true,
			withFileTypes: true,
		}).filter((e) => e.isFile());
		assert.ok(files.length > 0);
		for (const f of files) {
			const text = readFileSync(join(f.parentPath, f.name), "utf8");
			assert.doesNotMatch(text, /\sdata-[a-z]/, f.name);
			assert.doesNotMatch(text, WEB_HOOKS, f.name);
		}
	});

	it("se capturan sus pantallas públicas y privada en una llamada, sin datos de una web real en la salida", async () => {
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["inicio", "menu-abierto", "privado"],
		});
		assert.equal(r.isError, false, r.text);
		const files = r.out["files"] as { screen: string; path: string }[];
		assert.deepEqual(
			files.map((f) => f.screen),
			["inicio", "menu-abierto", "privado"],
		);
		for (const f of files)
			assert.doesNotMatch(readFileSync(f.path, "utf8"), WEB_HOOKS, f.path);
	});
});
