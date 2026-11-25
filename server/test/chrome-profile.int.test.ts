// Perfil de Chrome por defecto (spikes/m0/profile.sh, lo usan chrome.sh y login.sh).
// Se prueba la función con un HOME temporal: no se lanza Chrome ni se lee ningún .env.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { parseLayered, REPO_ROOT } from "#adapters/config/schema.ts";

const PROFILE_SH = join(import.meta.dirname, "../../spikes/m0/profile.sh");
const NEW = ".cache/figma-control-center-chrome";

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "figma-home-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const resolve = (env: Record<string, string> = {}) => {
	const r = spawnSync(
		"bash",
		["-c", `source "${PROFILE_SH}"; resolve_chrome_profile`],
		{
			env: { PATH: process.env["PATH"] ?? "", HOME: home, ...env },
			encoding: "utf8",
		},
	);
	return { path: r.stdout.trim(), stderr: r.stderr, code: r.status };
};
const mk = (rel: string) => mkdirSync(join(home, rel), { recursive: true });

describe("un FIGMA_CHROME_PROFILE relativo o dentro del repo", () => {
	it("un perfil relativo se resuelve contra la raíz del repo, como el esquema (y los dos coinciden)", () => {
		const fromSchema = parseLayered(
			{
				FIGMA_FILE_URL: "https://www.figma.com/design/abc/N",
				FIGMA_CHROME_PROFILE: "../perfil-de-prueba",
			},
			"prueba",
		).machine.chrome.profile;
		const r = resolve({ FIGMA_CHROME_PROFILE: "../perfil-de-prueba" });
		assert.equal(r.path, resolvePath(REPO_ROOT, "../perfil-de-prueba"));
		assert.equal(r.path, fromSchema);
		assert.equal(r.code, 0);
	});

	it("un perfil dentro del repo se rechaza en los scripts: guarda la sesión de Figma y git no lo ignora", () => {
		for (const profile of ["perfil", "./perfil", join(REPO_ROOT, "perfil")]) {
			const r = resolve({ FIGMA_CHROME_PROFILE: profile });
			assert.notEqual(r.code, 0, profile);
			assert.equal(r.path, "", profile);
			assert.match(r.stderr, /dentro del repo/, profile);
		}
	});

	it("y también en el esquema, con el mismo criterio", () => {
		for (const profile of ["perfil", join(REPO_ROOT, "perfil")]) {
			assert.throws(
				() =>
					parseLayered(
						{
							FIGMA_FILE_URL: "https://www.figma.com/design/abc/N",
							FIGMA_CHROME_PROFILE: profile,
						},
						"prueba",
					),
				(e: Error) =>
					e.message.includes("FIGMA_CHROME_PROFILE") &&
					e.message.includes("dentro del repo"),
				profile,
			);
		}
	});
});

describe("resolve_chrome_profile", () => {
	it("sin perfiles, el de por defecto", () => {
		const r = resolve();
		assert.equal(r.path, join(home, NEW));
		assert.equal(r.stderr, "");
	});

	it("con el perfil por defecto presente usa ese", () => {
		mk(NEW);
		const r = resolve();
		assert.equal(r.path, join(home, NEW));
		assert.equal(r.stderr, "");
	});

	it("con FIGMA_CHROME_PROFILE fijada manda la variable, exista o no el perfil por defecto", () => {
		mk(NEW);
		const r = resolve({ FIGMA_CHROME_PROFILE: "~/otro-perfil" });
		assert.equal(r.path, join(home, "otro-perfil"));
		assert.equal(r.stderr, "");
	});
});
