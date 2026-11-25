// E65 retención: al arrancar el servidor se borran los intentos viejos y se queda el último `ok`
// de cada objetivo; los contenidos que ningún intento usa se borran; un script mayor que FCC_SCRIPT_MAX_BYTES queda
// como hash y tamaño y figma_history_script lo dice. Servidor MCP real + SQLite, con el simulador de Figma.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";

let env: Environment;
let root: string | undefined;
afterEach(async () => {
	await env?.stop();
	if (root !== undefined) await rm(root, { recursive: true, force: true });
	root = undefined;
});

const LONG_AGO = 1_000_000_000_000;
const sha = (c: string) => c.repeat(64);

// Un intento sembrado a mano (con su contenido de paso): sin pasar por el servidor, para fijar su fecha
function seedAttempt(
	n: number,
	status: "ok" | "error",
	stepSha: string,
	target = "viejo.js",
) {
	env.exec(
		`INSERT OR IGNORE INTO script_blobs (project_id, sha256, kind, bytes, stored, content, first_at, last_used_at)
		 VALUES (1, '${stepSha}', 'js', 3, 'full', NULL, ${LONG_AGO}, ${LONG_AGO})`,
	);
	env.exec(
		`INSERT INTO attempts (project_id, kind, target, n, started_at, finished_at, status, kit, kit_sha256)
		 VALUES (1, 'run_script', '${target}', ${n}, ${LONG_AGO + n}, ${LONG_AGO + n + 1}, '${status}', 'figma-kit@1', '${sha("f")}')`,
	);
	env.exec(
		`INSERT INTO attempt_scripts (project_id, attempt_id, role, path, sha256)
		 VALUES (1, (SELECT id FROM attempts WHERE project_id = 1 AND target = '${target}' AND n = ${n}), 'step', '', '${stepSha}')`,
	);
}

describe("E65 · retención de intentos", () => {
	it("se borran los intentos viejos, se queda el último ok de cada objetivo y los contenidos sin uso se borran", async () => {
		env = await startEnvironment({ dashboard: false });
		// viejo.js: 1 ok, 2 ok (el último ok: se protege), 3 error (posterior al último ok). nunca-ok.js: un error
		seedAttempt(1, "ok", sha("1"));
		seedAttempt(2, "ok", sha("2"));
		seedAttempt(3, "error", sha("3"));
		seedAttempt(1, "error", sha("4"), "nunca-ok.js");
		assert.equal(env.rows("SELECT 1 FROM attempts").length, 4);

		// La limpieza corre al arrancar la sesión del servidor
		await env.startClaude({ reply: null });

		assert.deepEqual(
			env.rows("SELECT target, n FROM attempts ORDER BY target, n"),
			[{ target: "viejo.js", n: 2 }],
		);
		assert.deepEqual(
			env
				.rows("SELECT sha256 FROM script_blobs")
				.map((r) => (r as { sha256: string }).sha256),
			[sha("2")],
			"los contenidos que ningún intento usa se borran",
		);
		assert.equal(env.rows("SELECT 1 FROM attempt_scripts").length, 1);
	});

	it("un intento reciente no se toca aunque no sea ok: solo cuenta la antigüedad", async () => {
		env = await startEnvironment({ dashboard: false });
		seedAttempt(1, "error", sha("1"));
		const now = Date.now();
		env.exec(
			`UPDATE attempts SET started_at = ${now}, finished_at = ${now + 1}`,
		);
		await env.startClaude({ reply: null });
		assert.equal(env.rows("SELECT 1 FROM attempts").length, 1);
		assert.equal(env.rows("SELECT 1 FROM script_blobs").length, 1);
	});

	it("un script mayor que FCC_SCRIPT_MAX_BYTES queda como hash y tamaño, y figma_history_script lo dice", async () => {
		root = await mkdtemp(join(tmpdir(), "figma-grande-"));
		const big = `// @scenario: write-created\n${"// relleno\n".repeat(50)}return 1;\n`;
		await writeFile(join(root, "grande.js"), big);
		env = await startEnvironment({
			dashboard: false,
			scriptsRoot: root,
			extraEnv: { FCC_SCRIPT_MAX_BYTES: "100" },
		});
		const claude = await env.startClaude({ reply: null });
		const ran = await claude.callTool(TOOL_NAME.runScript, {
			file: join(root, "grande.js"),
			format: "body",
		});
		assert.equal(ran.isError, false);

		const list = await claude.callTool(TOOL_NAME.historyAttempts, {
			target: "grande",
		});
		const [attempt] = list.out["items"] as {
			id: number;
			scripts: { role: string; stored: string; bytes: number }[];
		}[];
		const step = attempt?.scripts.find((s) => s.role === "step");
		assert.equal(step?.stored, "too_big");
		assert.equal(step?.bytes, Buffer.byteLength(big));
		const kit = attempt?.scripts.find((s) => s.role === "kit");
		assert.equal(
			kit?.stored,
			"too_big",
			"el kit también pasa del tope de esta prueba",
		);

		const asked = await claude.callTool(TOOL_NAME.historyScript, {
			attempt: attempt?.id,
			role: "step",
		});
		assert.equal(asked.isError, true);
		assert.match(asked.text, /FCC_SCRIPT_MAX_BYTES/);
		assert.match(asked.text, /solo se guardó su hash/);
		const row = env.rows<{ content: Buffer | null; stored: string }>(
			"SELECT content, stored FROM script_blobs WHERE bytes = " +
				Buffer.byteLength(big),
		)[0];
		assert.deepEqual([row?.content, row?.stored], [null, "too_big"]);
	});
});
