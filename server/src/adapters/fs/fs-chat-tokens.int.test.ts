import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { FsChatTokens } from "./fs-chat-tokens.ts";

let base: string;
let n = 0;
before(async () => {
	base = await mkdtemp(join(tmpdir(), "figma-tokens-"));
});
after(() => rm(base, { recursive: true, force: true }));

const fresh = () => {
	const dir = join(base, `caso-${++n}`, "chat");
	return { dir, tokens: new FsChatTokens({ dir }) };
};
const SESSION = "0b8a6f1e-4c3d-4a55-9d0e-2f6d5e7a8b9c";

describe("FsChatTokens (el token no pasa por la web ni por la base)", () => {
	it("lo que publica una sesión lo lee el panel", () => {
		const { tokens } = fresh();
		tokens.publish(SESSION, "secreto");
		assert.equal(tokens.read(SESSION), "secreto");
	});

	it("el archivo y la carpeta son solo del usuario", () => {
		const { dir, tokens } = fresh();
		tokens.publish(SESSION, "secreto");
		assert.equal(statSync(dir).mode & 0o777, 0o700);
		assert.equal(statSync(join(dir, `${SESSION}.token`)).mode & 0o777, 0o600);
	});

	it("publicar otra vez sustituye el token (la sesión se reinició)", () => {
		const { tokens } = fresh();
		tokens.publish(SESSION, "uno");
		tokens.publish(SESSION, "dos");
		assert.equal(tokens.read(SESSION), "dos");
	});

	it("una sesión sin token devuelve null, y revocar lo borra", () => {
		const { dir, tokens } = fresh();
		assert.equal(tokens.read(SESSION), null);
		tokens.publish(SESSION, "uno");
		tokens.revoke(SESSION);
		assert.equal(tokens.read(SESSION), null);
		assert.equal(existsSync(join(dir, `${SESSION}.token`)), false);
		assert.doesNotThrow(() => tokens.revoke(SESSION));
	});

	it("un id de sesión que no parece un id no sale de la carpeta (el id llega del navegador)", () => {
		const { tokens } = fresh();
		tokens.publish(SESSION, "uno");
		for (const bad of ["../x", "a/b", "..", "", "x.token", "a b", "\0"]) {
			assert.equal(tokens.read(bad), null, JSON.stringify(bad));
			assert.throws(() => tokens.publish(bad, "t"), /id de sesión/);
		}
	});
});
