import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { NodeProcessSpawner } from "./node-process-spawner.ts";

const POLL_MS = 20;
const WAIT_MS = 5_000;

let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-spawn-"));
});
after(() => rm(dir, { recursive: true, force: true }));

async function eventually(file: string): Promise<string> {
	const until = Date.now() + WAIT_MS;
	for (;;) {
		try {
			return await readFile(file, "utf8");
		} catch (e) {
			if (Date.now() > until) throw e;
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
	}
}

describe("NodeProcessSpawner", () => {
	it("arranca el proceso y devuelve su pid", async () => {
		const result = await new NodeProcessSpawner().spawn(
			[process.execPath, "-e", "0"],
			{ cwd: dir },
		);
		assert.equal(result.ok, true);
		assert.ok(result.ok && Number.isInteger(result.value.pid));
	});

	it("un ejecutable que no existe es NotFound, no una excepción", async () => {
		const result = await new NodeProcessSpawner().spawn(
			["figma-terminal-que-no-existe", "--"],
			{ cwd: dir },
		);
		assert.deepEqual(
			[result.ok, !result.ok && result.error.type],
			[false, "NotFound"],
		);
	});

	it("no pasa por un shell: los metacaracteres llegan como texto literal al programa", async () => {
		const out = join(dir, "argv.txt");
		const hostile = "$(touch pwned); `touch pwned2` && echo hola";
		const script =
			"require('node:fs').writeFileSync(process.argv[1], process.argv[2])";
		const result = await new NodeProcessSpawner().spawn(
			[process.execPath, "-e", script, out, hostile],
			{ cwd: dir },
		);
		assert.equal(result.ok, true);
		assert.equal(await eventually(out), hostile);
		await assert.rejects(readFile(join(dir, "pwned")));
	});

	it("arranca en el directorio pedido", async () => {
		const out = join(dir, "cwd.txt");
		const script =
			"require('node:fs').writeFileSync(process.argv[1], process.cwd())";
		await new NodeProcessSpawner().spawn(
			[process.execPath, "-e", script, out],
			{
				cwd: dir,
			},
		);
		assert.equal(await eventually(out), await realpath(dir));
	});
});
