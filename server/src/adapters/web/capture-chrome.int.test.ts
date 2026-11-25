import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sweepOrphanProfiles } from "./capture-chrome.ts";
import { LEGACY_PROFILE_PREFIX, PROFILE_PREFIX } from "./protocol.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "fcc-profiles-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("sweepOrphanProfiles", () => {
	it("borra los perfiles con el prefijo nuevo y con el de antes, y deja lo demás", async () => {
		await mkdir(join(dir, `${PROFILE_PREFIX}a`));
		await mkdir(join(dir, `${LEGACY_PROFILE_PREFIX}b`));
		await mkdir(join(dir, "otra-cosa"));
		assert.equal(await sweepOrphanProfiles(dir), 2);
		assert.deepEqual(await readdir(dir), ["otra-cosa"]);
	});

	it("el prefijo nuevo está en inglés", () => {
		assert.equal(PROFILE_PREFIX, "figma-web-capture-");
	});

	it("sin carpeta de perfiles no hay nada que barrer", async () => {
		assert.equal(await sweepOrphanProfiles(join(dir, "no-existe")), 0);
	});
});
