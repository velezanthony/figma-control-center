import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createFsOpenLock } from "./fs-open-lock.ts";

const dirs: string[] = [];
const tmp = () => {
	const dir = mkdtempSync(join(tmpdir(), "figma-open-lock-"));
	dirs.push(dir);
	return dir;
};
after(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const lockFor = (dir: string, pid: number, alive: (pid: number) => boolean) =>
	createFsOpenLock({ dir, pid, isAlive: alive, pollMs: 5, timeoutMs: 1000 });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createFsOpenLock", () => {
	it("dos sesiones sobre el mismo archivo no abren a la vez (exclusión entre procesos por fichero)", async () => {
		const dir = tmp();
		const a = lockFor(dir, 1, () => true);
		const b = lockFor(dir, 2, () => true);
		let inside = 0;
		let maxInside = 0;
		const run = async () => {
			inside++;
			maxInside = Math.max(maxInside, inside);
			await delay(30);
			inside--;
		};
		await Promise.all([a.withLock("KEY", run), b.withLock("KEY", run)]);
		assert.equal(maxInside, 1);
	});

	it("archivos distintos no se esperan entre sí", async () => {
		const dir = tmp();
		const a = lockFor(dir, 1, () => true);
		const b = lockFor(dir, 2, () => true);
		let inside = 0;
		let maxInside = 0;
		const run = async () => {
			inside++;
			maxInside = Math.max(maxInside, inside);
			await delay(30);
			inside--;
		};
		await Promise.all([a.withLock("A", run), b.withLock("B", run)]);
		assert.equal(maxInside, 2);
	});

	it("suelta el lock aunque la apertura falle", async () => {
		const dir = tmp();
		const a = lockFor(dir, 1, () => true);
		await assert.rejects(
			a.withLock("KEY", async () => {
				throw new Error("boom");
			}),
		);
		assert.equal(existsSync(join(dir, "open-KEY.lock")), false);
		assert.equal(await a.withLock("KEY", async () => "ok"), "ok");
	});

	it("un lock de un proceso que ya no existe se quita y se sigue", async () => {
		const dir = tmp();
		writeFileSync(join(dir, "open-KEY.lock"), JSON.stringify({ pid: 999 }));
		const a = lockFor(dir, 1, (pid) => pid !== 999);
		assert.equal(await a.withLock("KEY", async () => "ok"), "ok");
	});

	it("si el lock no se libera a tiempo, falla en vez de abrir sin él", async () => {
		const dir = tmp();
		writeFileSync(join(dir, "open-KEY.lock"), JSON.stringify({ pid: 2 }));
		const a = createFsOpenLock({
			dir,
			pid: 1,
			isAlive: () => true,
			pollMs: 5,
			timeoutMs: 40,
		});
		await assert.rejects(
			a.withLock("KEY", async () => "no"),
			/abrir la pestaña/,
		);
	});
});
