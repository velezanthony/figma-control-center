// Los scripts de shell no leen el esquema: repiten sus valores por defecto. Este test los ata para que no diverjan.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseLayered, REPO_ROOT } from "#adapters/config/schema.ts";

const read = (file: string): string =>
	readFileSync(join(REPO_ROOT, file), "utf8");
const defaults = parseLayered(
	{ FIGMA_FILE_URL: "https://www.figma.com/design/abc/N" },
	"prueba",
).machine;

// Todos los valores por defecto `env_get VAR valor` de una variable en un fichero
const fallbacks = (text: string, name: string): string[] =>
	[...text.matchAll(new RegExp(`env_get ${name} (\\S+)\\)`, "g"))].map(
		(m) => m[1] ?? "",
	);

const SCRIPTS = [
	"spikes/m0/chrome.sh",
	"spikes/m0/login.sh",
	"Makefile",
] as const;

describe("defaults de los scripts frente al esquema", () => {
	it("el puerto de depuración de cada script es el del esquema", () => {
		let seen = 0;
		for (const file of SCRIPTS) {
			const text = read(file);
			for (const value of fallbacks(text, "FIGMA_CDP_PORT")) {
				seen++;
				assert.equal(Number(value), defaults.cdp.port, file);
			}
		}
		assert.ok(seen >= 3, "se esperaban al menos tres defaults de puerto");
	});

	it("el host de depuración de chrome.sh es el del esquema", () => {
		const values = fallbacks(read("spikes/m0/chrome.sh"), "FIGMA_CDP_HOST");
		assert.ok(values.length > 0);
		for (const value of values) assert.equal(value, defaults.cdp.host);
	});

	it("el perfil de Chrome por defecto de profile.sh es el del esquema", () => {
		const match = /CHROME_PROFILE_DEFAULT="([^"]+)"/.exec(
			read("spikes/m0/profile.sh"),
		);
		assert.ok(match);
		const profile = (match[1] ?? "").replace("$HOME", homedir());
		assert.equal(profile, defaults.chrome.profile);
	});
});
