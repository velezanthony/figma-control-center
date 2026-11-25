// E44 nombre de las capturas: screenshots/<fecha>/<nodo>_<hora>.png con la hora local, la ruta completa en el histórico,
// el panel la sirve por esa subcarpeta y no abre path traversal. Servidor MCP y panel reales, simulador de Figma.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { pngDimensions } from "../../contracts/figma-values.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";
import { until } from "../../harness/wait.ts";

const NODE = "10:1";
const NAME =
	/^screenshots\/(\d{4})-(\d{2})-(\d{2})\/10-1_(\d{2})(\d{2})(\d{2})(-\d+)?\.png$/;

let env: Environment;
let claude: FakeClaudeCode;
before(async () => {
	env = await startEnvironment({ dashboard: true });
	claude = await env.startClaude({ reply: null });
});
after(async () => {
	await env?.stop();
});

describe("E44 · nombre de las capturas", () => {
	let path = "";
	let inside = "";

	it("la captura se guarda en screenshots/<fecha>/<nodo>_<hora>.png con la hora local", async () => {
		const started = new Date();
		const r = await claude.callTool(TOOL_NAME.screenshot, {
			nodeId: NODE,
			scale: 1,
		});
		const finished = new Date();
		assert.equal(r.isError, false);
		path = String(r.out["path"]);
		inside = relative(env.env["FCC_OUTPUT_DIR"] ?? "", path);
		const m = NAME.exec(inside.split("\\").join("/"));
		assert.ok(m, inside);
		const taken = new Date(
			Number(m[1]),
			Number(m[2]) - 1,
			Number(m[3]),
			Number(m[4]),
			Number(m[5]),
			Number(m[6]),
		).getTime();
		// Hora local de ahora (con un segundo de margen por el redondeo del nombre)
		assert.ok(taken >= started.getTime() - 1000 && taken <= finished.getTime());
		assert.ok(pngDimensions(await readFile(path)) !== null);
	});

	it("el histórico guarda la ruta completa", async () => {
		await until(
			"la base registra la captura",
			() =>
				env.rows(`SELECT 1 FROM captures WHERE path = '${path}'`).length === 1,
		);
	});

	it("el panel la sirve por su subcarpeta y rechaza el path traversal", async () => {
		const ok = await fetch(`${env.dashboardUrl}/screenshots/${inside}`);
		assert.equal(ok.status, 200);
		assert.equal(ok.headers.get("content-type"), "image/png");
		const day = inside.split("/")[1] ?? "";
		for (const bad of [
			`screenshots/${day}/..%2f..%2fhistory.db`,
			`screenshots/${day}/../../../etc/passwd.png`,
			`screenshots/otra/10-1_000000.png`,
		]) {
			const r = await fetch(`${env.dashboardUrl}/screenshots/${bad}`);
			assert.equal(r.status, 404, bad);
		}
	});
});
