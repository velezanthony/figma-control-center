// E90 diff de intentos: tres figma_run_script del mismo fichero, cambiándolo en el
// tercero: el diff de 2 a 3 trae la línea cambiada y el de 1 a 2 sale vacío; los params se comparan formateados; el
// diff de la respuesta se recorta y el entero queda en history-diffs/; los prompts `attempts` y `attempt-changes`
// nombran las herramientas; otro proyecto no ve estos intentos. Servidor MCP real + SQLite, con el simulador de Figma.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

type Attempt = { id: number; n: number };
type Diff = {
	roles: {
		role: string;
		state: string;
		added: number | null;
		removed: number | null;
	}[];
	diff: {
		role: string;
		kind: string;
		text: string;
		truncated: boolean;
		file: string | null;
		added: number;
		removed: number;
	} | null;
};

const SCRIPT =
	"// @scenario: write-created\nreturn { createdNodeIds: ['10:1'] };\n";

async function start(extraEnv: Record<string, string> = {}) {
	root = await mkdtemp(join(tmpdir(), "figma-diff-intentos-"));
	await writeFile(join(root, "paso.js"), SCRIPT);
	env = await startEnvironment({
		dashboard: false,
		scriptsRoot: root,
		extraEnv,
	});
	return { dir: root, claude: await env.startClaude({ reply: null }) };
}

describe("E90 · diff de intentos", () => {
	it("de 2 a 3 trae la línea cambiada; de 1 a 2 sale vacío", async () => {
		const { dir, claude } = await start();
		const run = (params?: unknown) =>
			claude.callTool(TOOL_NAME.runScript, {
				file: join(dir, "paso.js"),
				format: "body",
				...(params !== undefined && { params }),
			});
		await run();
		await run();
		await writeFile(join(dir, "paso.js"), `${SCRIPT}// ahora cambia\n`);
		await run();
		const items = (
			await claude.callTool(TOOL_NAME.historyAttempts, { target: "paso.js" })
		).out["items"] as Attempt[];
		const id = (n: number) => items.find((i) => i.n === n)?.id;

		const same = await claude.callTool(TOOL_NAME.historyDiff, {
			from: id(1),
			to: id(2),
		});
		assert.equal(same.isError, false, same.text);
		assert.equal((same.out as unknown as Diff).diff, null);
		assert.ok(
			(same.out as unknown as Diff).roles.every((r) => r.state === "same"),
		);

		const changed = await claude.callTool(TOOL_NAME.historyDiff, {
			from: id(2),
			to: id(3),
		});
		const out = changed.out as unknown as Diff;
		assert.equal(out.diff?.role, "step");
		assert.equal(out.diff?.kind, "diff");
		assert.match(out.diff?.text ?? "", /^\+\/\/ ahora cambia$/m);
		assert.equal(out.diff?.added, 1);
		assert.equal(out.diff?.removed, 0);
		assert.equal(out.roles.find((r) => r.role === "step")?.state, "changed");
		assert.equal(out.roles.find((r) => r.role === "kit")?.state, "same");
	});

	it("los params se comparan formateados: sale el campo que cambió", async () => {
		const { dir, claude } = await start();
		const run = (params: unknown) =>
			claude.callTool(TOOL_NAME.runScript, {
				file: join(dir, "paso.js"),
				format: "body",
				params,
			});
		await run({ b: 1, a: { x: 1, y: 2 } });
		await run({ b: 1, a: { x: 1, y: 3 } });
		const items = (
			await claude.callTool(TOOL_NAME.historyAttempts, { target: "paso.js" })
		).out["items"] as Attempt[];
		const r = await claude.callTool(TOOL_NAME.historyDiff, {
			from: items[0]?.id,
			to: items[1]?.id,
		});
		const out = r.out as unknown as Diff;
		assert.equal(out.diff?.role, "params");
		assert.match(out.diff?.text ?? "", /^-\s+"y": 2$/m);
		assert.match(out.diff?.text ?? "", /^\+\s+"y": 3$/m);
	});

	it("el diff de la respuesta se recorta a FCC_HISTORY_DIFF_INLINE_LINES y el entero queda en history-diffs/", async () => {
		const { dir, claude } = await start({
			FCC_HISTORY_DIFF_INLINE_LINES: "3",
		});
		const run = () =>
			claude.callTool(TOOL_NAME.runScript, {
				file: join(dir, "paso.js"),
				format: "body",
			});
		await run();
		const many = Array.from({ length: 30 }, (_, i) => `// línea ${i}`).join(
			"\n",
		);
		await writeFile(join(dir, "paso.js"), `${SCRIPT}${many}\n`);
		await run();
		const items = (
			await claude.callTool(TOOL_NAME.historyAttempts, { target: "paso.js" })
		).out["items"] as Attempt[];
		const r = await claude.callTool(TOOL_NAME.historyDiff, {
			from: items[0]?.id,
			to: items[1]?.id,
		});
		const diff = (r.out as unknown as Diff).diff;
		assert.equal(diff?.truncated, true);
		assert.equal((diff?.text ?? "").split("\n").length - 1, 3);
		assert.match(String(diff?.file), /history-diffs[\\/]\d+-\d+-step\.diff$/);
		const whole = await readFile(String(diff?.file), "utf8");
		assert.equal(
			whole.split("\n").filter((l) => l.startsWith("+// línea")).length,
			30,
		);
	});

	it("los prompts attempts y attempt-changes nombran las herramientas del historial", async () => {
		const { claude } = await start();
		const attempts = await claude.prompt("attempts", { target: "paso.js" });
		assert.match(attempts, new RegExp(TOOL_NAME.historyAttempts));
		const changes = await claude.prompt("attempt-changes", {
			target: "paso.js",
			a: "1",
			b: "2",
		});
		assert.match(changes, new RegExp(TOOL_NAME.historyDiff));
		assert.match(await claude.prompt("costly-screens"), /intentos/);
	});

	it("otro proyecto no los ve: un id ajeno es «no encontrado», no un diff", async () => {
		// Sesión atada al proyecto 1: con un segundo proyecto en la base, sin alcance pediría elegir uno
		const { dir, claude } = await start({ FCC_PROJECTS: "1" });
		await claude.callTool(TOOL_NAME.runScript, {
			file: join(dir, "paso.js"),
			format: "body",
		});
		env.exec(
			"INSERT INTO projects (id, name, project_dir, file_url, file_key, output_dir) VALUES (2, 'otro', '/otro', 'https://www.figma.com/design/OTRO/Otro', 'OTRO', '/otro/salida')",
		);
		for (const n of [1, 2]) {
			env.exec(
				`INSERT INTO attempts (project_id, kind, target, n, started_at, finished_at, status, kit, kit_sha256)
				 VALUES (2, 'run_script', 'ajeno.js', ${n}, ${n}, ${n + 1}, 'ok', 'figma-kit@1', '${"b".repeat(64)}')`,
			);
		}
		const foreign = env.rows<{ id: number }>(
			"SELECT id FROM attempts WHERE project_id = 2 ORDER BY n",
		);
		const mine = (
			await claude.callTool(TOOL_NAME.historyAttempts, { target: "paso.js" })
		).out["items"] as Attempt[];
		const r = await claude.callTool(TOOL_NAME.historyDiff, {
			from: foreign[0]?.id,
			to: foreign[1]?.id,
		});
		assert.equal(r.isError, true);
		assert.match(r.text, /No hay ningún intento/);
		const crossed = await claude.callTool(TOOL_NAME.historyDiff, {
			from: mine[0]?.id,
			to: foreign[0]?.id,
		});
		assert.equal(crossed.isError, true);
	});
});
