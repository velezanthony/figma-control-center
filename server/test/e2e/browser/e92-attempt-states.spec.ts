// E92 estados de «Intentos»: sin intentos, filtros sin resultado, objetivo inexistente
// en la URL, un contenido que pasó del tope (too_big) y una llamada que la retención ya borró.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { expect, test } from "./fixtures.ts";

const HEAD =
	"// @scenario: write-created\nreturn { createdNodeIds: ['10:1'] };\n";

test("E92 · sin intentos, y filtros que no dejan ninguno", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	await page.goto(`${env.dashboardUrl}/#/attempts`);
	await expect(page.getByText("Todavía no hay intentos")).toBeVisible();
	await expect(
		page.getByText(
			/cada figma_run_script, cada paso de figma_build y cada captura deja uno/i,
		),
	).toBeVisible();
});

test("E92 · un objetivo que no existe en la URL dice que no tiene intentos y vuelve a la lista", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	await page.goto(`${env.dashboardUrl}/#/attempts?t=no-existe.js&k=run_script`);
	await expect(
		page.getByText("Ese objetivo no tiene intentos en este proyecto"),
	).toBeVisible();
	await page.getByRole("button", { name: "Volver a la lista" }).click();
	await expect.poll(() => new URL(page.url()).hash).toBe("#/attempts");
});

test("E92 · un contenido que pasó de FCC_SCRIPT_MAX_BYTES dice que solo se guardó el hash", async ({
	page,
	makeEnv,
}) => {
	const dir = await mkdtemp(join(tmpdir(), "figma-e92-"));
	const env = await makeEnv({
		scriptsRoot: dir,
		extraEnv: { FCC_SCRIPT_MAX_BYTES: "300" },
	});
	const claude = await env.startClaude({ reply: null });
	const pad = (tag: string) => `${HEAD}// ${tag} ${"x".repeat(400)}\n`;
	for (const tag of ["uno", "dos"]) {
		await writeFile(join(dir, "largo.js"), pad(tag));
		await claude.callTool(TOOL_NAME.runScript, {
			file: join(dir, "largo.js"),
			format: "body",
		});
	}
	await page.goto(`${env.dashboardUrl}/#/attempts?t=largo.js&k=run_script`);
	await expect(page.getByRole("button", { name: /^Script/ })).toContainText(
		"solo hash",
	);
	await expect(
		page.getByText("Solo se guardó el hash (pasó de FCC_SCRIPT_MAX_BYTES)"),
	).toBeVisible();
});

test("E92 · una llamada que la retención ya borró no tiene enlace y lo dice", async ({
	page,
	makeEnv,
}) => {
	const dir = await mkdtemp(join(tmpdir(), "figma-e92-"));
	const env = await makeEnv({ scriptsRoot: dir });
	const claude = await env.startClaude({ reply: null });
	await writeFile(join(dir, "paso.js"), HEAD);
	await claude.callTool(TOOL_NAME.runScript, {
		file: join(dir, "paso.js"),
		format: "body",
	});
	env.exec("PRAGMA foreign_keys = OFF");
	env.exec("DELETE FROM calls");
	await page.goto(`${env.dashboardUrl}/#/attempts?t=paso.js&k=run_script`);
	await expect(
		page.getByText("La llamada ya no está en el histórico"),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Ver en Actividad" }),
	).toHaveCount(0);
});
