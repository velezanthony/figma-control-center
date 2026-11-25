// E59 ganchos y estados: prepare, ready e ignore de example-mini se aplican; un clic
// abre el menú y sale abierto; un `until` que no llega es StateNotReached; evaluateInPage sin allowPageWorld es un error de
// uso y con él funciona (en el mundo de la página).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type CaptureEnvironment,
	startCaptureEnvironment,
} from "../../harness/capture-environment.ts";

// La espera de cada pantalla: corta, para que el `until` que no llega no alargue el test
const PAGE_TIMEOUT_MS = 3000;

let c: CaptureEnvironment;
before(async () => {
	c = await startCaptureEnvironment({
		extraEnv: { FCC_WEB_PAGE_TIMEOUT_MS: String(PAGE_TIMEOUT_MS) },
	});
});
after(async () => {
	await c?.stop();
});

const texts = async (
	screens: string[],
	extra: Record<string, unknown> = {},
) => {
	const r = await c.claude.callTool(TOOL_NAME.capture, { screens, ...extra });
	assert.equal(r.isError, false, r.text);
	const path = (r.out["files"] as { path: string }[])[0]?.path ?? "";
	return [...readFileSync(path, "utf8").matchAll(/"txt":"([^"]*)"/g)].map(
		(m) => m[1],
	);
};

describe("E59 · ganchos y estados", () => {
	it("ready espera a la app, ignore deja fuera la publicidad y prepare acepta las cookies; strip quita el aviso", async () => {
		const seen = await texts(["inicio"]);
		assert.ok(seen.includes("Listo"), seen.join(" | "));
		assert.equal(seen.includes("Cargando"), false);
		assert.equal(seen.includes("Anuncio"), false);
		assert.equal(seen.includes("Aceptar cookies"), false);
		assert.equal(seen.includes("Aviso"), false);
	});

	it("un clic abre el menú y la captura lo trae abierto", async () => {
		const seen = await texts(["menu-abierto"]);
		assert.ok(seen.includes("Uno") && seen.includes("Dos"), seen.join(" | "));
	});

	it("un until que no llega da StateNotReached", async () => {
		const r = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["nunca"],
		});
		assert.equal(r.isError, true);
		assert.equal((r.out["error"] as { type: string }).type, "StateNotReached");
	});

	it("evaluateInPage sin allowPageWorld es un error de uso que nombra la pantalla; con él, escribe en la página", async () => {
		const refused = await c.claude.callTool(TOOL_NAME.capture, {
			screens: ["desde-pagina"],
		});
		assert.equal(refused.isError, true);
		assert.match(refused.text, /allowPageWorld[\s\S]*desde-pagina/);
		const seen = await texts(["desde-pagina"], { allowPageWorld: true });
		assert.ok(seen.includes("Escrito desde la página"), seen.join(" | "));
	});
});
