// Lock de lote entre procesos: un fichero por archivo de Figma (por su
// fileKey) en una carpeta de máquina, con el pid dentro. Se prueba con procesos de verdad, no con un Map.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, afterEach, before, describe, it } from "node:test";
import { toJobId } from "#domain/job.ts";
import { createFsTabLocks } from "./fs-build-lock.ts";

const WORKER = join(import.meta.dirname, "testing/lock-process.ts");
const FILE_A = "https://www.figma.com/design/AAA111/Archivo-A";
const FILE_B = "https://www.figma.com/design/BBB222/Archivo-B";
const SPAWN_SYNC_MS = 1500;

let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-locks-"));
});
after(() => rm(dir, { recursive: true, force: true }));

type Worker = {
	readonly pid: number;
	ask(line: string): Promise<string>;
	kill(): Promise<void>;
};
const open: ChildProcess[] = [];
afterEach(() => {
	for (const child of open.splice(0)) child.kill("SIGKILL");
});

async function startWorker(locksDir: string): Promise<Worker> {
	const child = spawn(process.execPath, [WORKER, locksDir], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	open.push(child);
	const lines = createInterface({ input: child.stdout });
	const waiting: Array<(line: string) => void> = [];
	lines.on("line", (line) => waiting.shift()?.(line));
	const ask = (line: string) =>
		new Promise<string>((resolve) => {
			waiting.push(resolve);
			child.stdin.write(`${line}\n`);
		});
	const pid = Number(await ask("pid"));
	return {
		pid,
		ask,
		kill: () =>
			new Promise((resolve) => {
				child.once("exit", () => resolve());
				child.kill("SIGKILL");
			}),
	};
}

const freshDir = async () => {
	const d = await mkdtemp(join(dir, "caso-"));
	return d;
};

describe("lock de lote entre procesos reales", () => {
	it("mientras A tiene un lote sobre un archivo, B no puede tener otro sobre el mismo", async () => {
		const locks = await freshDir();
		const a = await startWorker(locks);
		const b = await startWorker(locks);
		assert.equal(await a.ask(`try ${FILE_A} job-a`), "OK");
		assert.equal(await b.ask(`try ${FILE_A} job-b`), `BUSY ${a.pid}`);
		assert.equal(await b.ask(`active ${FILE_A}`), `job-a ${a.pid}`);
		assert.equal(await a.ask(`active ${FILE_A}`), "job-a own");
	});

	it("un lote sobre OTRO archivo no se bloquea", async () => {
		const locks = await freshDir();
		const a = await startWorker(locks);
		const b = await startWorker(locks);
		assert.equal(await a.ask(`try ${FILE_A} job-a`), "OK");
		assert.equal(await b.ask(`try ${FILE_B} job-b`), "OK");
	});

	it("las formas de URL de un mismo archivo son el mismo lock (por fileKey)", async () => {
		const locks = await freshDir();
		const a = await startWorker(locks);
		const b = await startWorker(locks);
		assert.equal(await a.ask(`try ${FILE_A} job-a`), "OK");
		for (const url of [
			"https://www.figma.com/design/AAA111",
			"https://www.figma.com/file/AAA111/Otro-nombre",
		]) {
			assert.equal(await b.ask(`try ${url} job-b`), `BUSY ${a.pid}`, url);
		}
		// Una clave que es prefijo de otra es otro archivo
		assert.equal(
			await b.ask("try https://www.figma.com/design/AAA job-b"),
			"OK",
		);
	});

	it("al soltarlo A, B ya puede", async () => {
		const locks = await freshDir();
		const a = await startWorker(locks);
		const b = await startWorker(locks);
		await a.ask(`try ${FILE_A} job-a`);
		assert.match(await b.ask(`try ${FILE_A} job-b`), /^BUSY/);
		assert.equal(await a.ask(`release ${FILE_A} job-a`), "OK");
		assert.equal(await b.ask(`try ${FILE_A} job-b`), "OK");
	});

	it("un proceso solo suelta su propio lock: soltar el de otro no lo quita", async () => {
		const locks = await freshDir();
		const a = await startWorker(locks);
		const b = await startWorker(locks);
		await a.ask(`try ${FILE_A} job-a`);
		await b.ask(`release ${FILE_A} job-a`);
		await b.ask("release-all");
		assert.equal(await b.ask(`active ${FILE_A}`), `job-a ${a.pid}`);
	});

	it("si A muere sin soltarlo (SIGKILL), su lock está muerto por el pid y B se lo queda", async () => {
		const locks = await freshDir();
		const a = await startWorker(locks);
		const b = await startWorker(locks);
		await a.ask(`try ${FILE_A} job-a`);
		await a.kill();
		assert.equal(await b.ask(`active ${FILE_A}`), "NONE");
		assert.equal(await b.ask(`try ${FILE_A} job-b`), "OK");
		assert.equal(await b.ask(`active ${FILE_A}`), "job-b own");
	});

	it("varios procesos que lo piden a la vez: solo uno lo consigue", async () => {
		for (let round = 0; round < 3; round++) {
			const locks = await freshDir();
			const workers = await Promise.all(
				Array.from({ length: 6 }, () => startWorker(locks)),
			);
			const at = Date.now() + SPAWN_SYNC_MS;
			const answers = await Promise.all(
				workers.map((w, i) => w.ask(`try-at ${at} ${FILE_A} job-${i}`)),
			);
			assert.equal(answers.filter((a) => a === "OK").length, 1, answers.join());
		}
	});

	it("tras morir el dueño, varios procesos a la vez: solo uno se lo queda", async () => {
		for (let round = 0; round < 3; round++) {
			const locks = await freshDir();
			const dead = await startWorker(locks);
			await dead.ask(`try ${FILE_A} job-viejo`);
			await dead.kill();
			const workers = await Promise.all(
				Array.from({ length: 5 }, () => startWorker(locks)),
			);
			const at = Date.now() + SPAWN_SYNC_MS;
			const answers = await Promise.all(
				workers.map((w, i) => w.ask(`try-at ${at} ${FILE_A} job-${i}`)),
			);
			assert.equal(answers.filter((a) => a === "OK").length, 1, answers.join());
		}
	});
});

describe("fichero del lock", () => {
	const pidNobody = () => false;

	it("lleva dentro el pid de quien lo tiene, el jobId y se llama como el fileKey", async () => {
		const locks = await freshDir();
		const set = createFsTabLocks({
			dir: locks,
			pid: 4242,
			isAlive: () => true,
		});
		assert.equal(set.forUrl(FILE_A).acquire(toJobId("job-1")), true);
		assert.deepEqual(await readdir(locks), ["AAA111.lock"]);
		const content = JSON.parse(
			await readFile(join(locks, "AAA111.lock"), "utf8"),
		);
		assert.equal(content.pid, 4242);
		assert.equal(content.jobId, "job-1");
	});

	it("un fichero ilegible se trata como lock muerto", async () => {
		const locks = await freshDir();
		await mkdir(locks, { recursive: true });
		await writeFile(join(locks, "AAA111.lock"), "no es json");
		const set = createFsTabLocks({ dir: locks, pid: 1, isAlive: () => true });
		assert.equal(set.forUrl(FILE_A).active(), undefined);
		assert.equal(set.forUrl(FILE_A).acquire(toJobId("job-1")), true);
	});

	it("un lock de un pid que no existe se quita al pedirlo", async () => {
		const locks = await freshDir();
		await writeFile(
			join(locks, "AAA111.lock"),
			JSON.stringify({
				pid: 99999,
				jobId: "viejo",
				at: "2026-01-01T00:00:00.000Z",
			}),
		);
		const set = createFsTabLocks({ dir: locks, pid: 1, isAlive: pidNobody });
		assert.equal(set.forUrl(FILE_A).acquire(toJobId("job-1")), true);
		const after = await readdir(locks);
		assert.deepEqual(after, ["AAA111.lock"]);
	});

	it("el mismo proceso tampoco puede tomarlo dos veces (no es reentrante)", async () => {
		const locks = await freshDir();
		const set = createFsTabLocks({ dir: locks, pid: 1, isAlive: () => true });
		assert.equal(set.forUrl(FILE_A).acquire(toJobId("job-1")), true);
		assert.equal(set.forUrl(FILE_A).acquire(toJobId("job-2")), false);
		// Ni por otra forma de la misma URL (dos tenants sobre el mismo archivo)
		assert.equal(
			set.forUrl("https://www.figma.com/file/AAA111").acquire(toJobId("job-3")),
			false,
		);
		assert.equal(set.forUrl(FILE_A).foreignPid?.(), undefined);
	});

	it("releaseAll quita los locks de este proceso (el apagado) y no deja temporales", async () => {
		const locks = await freshDir();
		const set = createFsTabLocks({ dir: locks, pid: 1, isAlive: () => true });
		set.forUrl(FILE_A).acquire(toJobId("job-1"));
		set.forUrl(FILE_B).acquire(toJobId("job-2"));
		set.releaseAll();
		assert.deepEqual(await readdir(locks), []);
	});
});
