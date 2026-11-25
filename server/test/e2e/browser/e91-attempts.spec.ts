// E91 página «Intentos»: lista con filtros y orden, detalle con el par por
// defecto, diff con n/p, contenido y «Abrir completo», enlace a Actividad, recargar conserva la vista, cambiar de
// proyecto la limpia y a 390 px la página no hace scroll horizontal. Hermético: los intentos salen de ejecutar scripts
// de verdad contra el simulador de Figma.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { expect, test } from "./fixtures.ts";

const HEAD =
	"// @scenario: write-created\nreturn { createdNodeIds: ['10:1'] };\n";
const BIG_LINES = 2500;

async function seed(
	makeEnv: (o?: {
		scriptsRoot?: string;
	}) => Promise<
		Awaited<
			ReturnType<typeof import("../../harness/environment.ts").startEnvironment>
		>
	>,
) {
	const dir = await mkdtemp(join(tmpdir(), "figma-e91-"));
	await mkdir(dir, { recursive: true });
	const env = await makeEnv({ scriptsRoot: dir });
	const claude = await env.startClaude({ reply: null });
	const run = (file: string, params?: unknown) =>
		claude.callTool(TOOL_NAME.runScript, {
			file: join(dir, file),
			format: "body",
			...(params !== undefined && { params }),
		});
	await writeFile(join(dir, "paso.js"), HEAD);
	await run("paso.js", { n: 1, nombre: "a" });
	await run("paso.js", { nombre: "b", n: 1 });
	await writeFile(join(dir, "paso.js"), `${HEAD}// ahora cambia\n`);
	await run("paso.js", { n: 1, nombre: "b" });
	await writeFile(join(dir, "otro.js"), HEAD);
	await run("otro.js");
	const big = (tail: string) =>
		`${HEAD}${Array.from({ length: BIG_LINES }, (_, i) => `// línea ${i}`).join("\n")}\n${tail}\n`;
	await writeFile(join(dir, "grande.js"), big("// v1"));
	await run("grande.js");
	await writeFile(join(dir, "grande.js"), big("// v2"));
	await run("grande.js");
	return env;
}

test("E91 · lista con filtros y orden, y el detalle con su par por defecto y su diff", async ({
	page,
	makeEnv,
}) => {
	const env = await seed(makeEnv);
	await page.goto(`${env.dashboardUrl}/#/attempts`);

	const table = page.getByRole("table", { name: "Objetivos con intentos" });
	const rows = table.getByRole("row");
	await expect(rows.filter({ hasText: "paso.js" })).toContainText("3");
	await expect(rows.filter({ hasText: "otro.js" })).toContainText("1");
	// Por intentos, el más intentado primero
	await expect(rows.nth(1)).toContainText("paso.js");

	// Filtro de texto: lo hace el servidor y queda en la URL
	await page.getByRole("searchbox", { name: "Buscar objetivo" }).fill("otro");
	await expect(rows.filter({ hasText: "paso.js" })).toHaveCount(0);
	await expect.poll(() => new URL(page.url()).hash).toContain("q=otro");
	await page.getByRole("button", { name: "Limpiar filtros" }).click();
	await expect(rows.filter({ hasText: "paso.js" })).toHaveCount(1);

	// Estado del último intento
	await page.getByRole("button", { name: /^Último estado:/ }).click();
	await page.getByRole("menuitemradio", { name: "Error" }).click();
	await expect(
		page.getByText("Ningún objetivo cumple estos filtros"),
	).toBeVisible();
	await page.getByRole("button", { name: "Quitar filtros" }).click();
	await expect(rows.filter({ hasText: "paso.js" })).toHaveCount(1);

	// Orden por el último: lo pide el servidor y la cabecera lo dice
	await table
		.getByRole("columnheader", { name: /^Último$/ })
		.getByRole("button")
		.click();
	await expect(
		table.getByRole("columnheader", { name: /^Último$/ }),
	).toHaveAttribute("aria-sort", /ascending|descending/);
	await expect.poll(() => new URL(page.url()).hash).toContain("sort=last");

	// Detalle
	await page.getByRole("button", { name: "paso.js", exact: true }).click();
	await expect.poll(() => new URL(page.url()).hash).toContain("t=paso.js");
	const timeline = page.getByRole("list", { name: /Intentos del objetivo/ });
	await expect(timeline.getByRole("listitem")).toHaveCount(3);
	// Par por defecto: el último («después») y el anterior («antes»)
	await expect(
		page.getByRole("button", { name: "Usar el intento 3 como después" }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("button", { name: "Usar el intento 2 como antes" }),
	).toHaveAttribute("aria-pressed", "true");

	// El primer papel que cambió queda abierto, con su diff
	const diff = page.getByRole("region", { name: "Cambios de Script" });
	await expect(diff).toContainText("// ahora cambia");
	await expect(
		diff.getByRole("heading", { name: /cambio 1 de 1/ }),
	).toBeVisible();
	// Del 2 al 3 los parámetros son los mismos con las claves en otro orden: cambió el texto, no una línea (D-5)
	await expect(page.getByRole("button", { name: /^Parámetros/ })).toContainText(
		"solo el orden o el formato",
	);

	// n salta de bloque y lo anuncia
	await diff.focus();
	await page.keyboard.press("n");
	await expect(
		page.getByRole("status").filter({ hasText: "cambio 1 de 1" }),
	).toHaveCount(1);

	// Recargar conserva la vista
	const before = new URL(page.url()).hash;
	await page.reload();
	expect(new URL(page.url()).hash).toBe(before);
	await expect(
		page
			.getByRole("list", { name: /Intentos del objetivo/ })
			.getByRole("listitem"),
	).toHaveCount(3);
	await expect(
		page.getByRole("region", { name: "Cambios de Script" }),
	).toContainText("// ahora cambia");

	// Otro par: del 1 al 2 los parámetros solo cambian de orden de claves y de valor
	await page
		.getByRole("button", { name: "Usar el intento 1 como antes" })
		.click();
	await page
		.getByRole("button", { name: "Usar el intento 2 como después" })
		.click();
	await expect.poll(() => new URL(page.url()).hash).toMatch(/a=\d+&b=\d+/);
	await page.getByRole("button", { name: /^Parámetros/ }).click();
	await expect(
		page.getByRole("region", { name: "Cambios de Parámetros" }),
	).toContainText('"nombre"');

	// Enlace a la llamada en Actividad
	await page.getByRole("link", { name: "Ver en Actividad" }).first().click();
	await expect
		.poll(() => new URL(page.url()).hash)
		.toMatch(/^#\/activity\?open=/);
});

test("E91 · contenido de un papel, recortado, con «Abrir completo» y «Copiar»", async ({
	page,
	makeEnv,
	context,
}) => {
	const env = await seed(makeEnv);
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(`${env.dashboardUrl}/#/attempts`);
	await page.getByRole("button", { name: "grande.js", exact: true }).click();

	await page.getByRole("tab", { name: "Después" }).click();
	const content = page.getByRole("region", {
		name: /Contenido de Script en el intento 2/,
	});
	await expect(content).toContainText("// línea 0");
	await expect(content).toContainText(
		"Recortado: se muestran las primeras 2000 líneas",
	);
	const link = content.getByRole("link", { name: "Abrir completo" });
	const href = (await link.getAttribute("href")) ?? "";
	expect(href).toContain("/script/raw?");
	const raw = await page.request.get(new URL(href, page.url()).toString());
	expect(raw.headers()["content-type"]).toContain("text/plain");
	expect(raw.headers()["x-content-type-options"]).toBe("nosniff");
	expect((await raw.text()).split("\n").length).toBeGreaterThan(BIG_LINES);

	await page.getByRole("button", { name: "Copiar" }).click();
	await expect(page.getByRole("button", { name: "Copiado" })).toBeVisible();
	expect(
		await page.evaluate(() =>
			(
				navigator as unknown as { clipboard: { readText(): Promise<string> } }
			).clipboard.readText(),
		),
	).toContain("// línea 0");
});

test("E91 · cambiar de proyecto limpia la vista", async ({ page, makeEnv }) => {
	const env = await seed(makeEnv);
	const created = await page.request.post(
		`${env.dashboardUrl}/api/projects/save`,
		{
			data: {
				entry: {
					name: "Otro",
					projectDir: "/tmp/otro",
					fileUrl: "https://www.figma.com/design/ABC123/Otro",
				},
			},
		},
	);
	expect(created.ok()).toBe(true);
	await page.goto(`${env.dashboardUrl}/#/attempts?t=paso.js&k=run_script`);
	const selector = page.getByRole("combobox", { name: "Proyecto activo" });
	await expect(selector.locator("option")).toHaveCount(2);
	await selector.selectOption({ label: "Otro" });
	await expect.poll(() => new URL(page.url()).hash).toBe("#/attempts");
	await expect(page.getByText("Todavía no hay intentos")).toBeVisible();
});

test.describe("tema oscuro", () => {
	test.use({ theme: "dark" });
	test("E91 · en oscuro el detalle se ve igual", async ({ page, makeEnv }) => {
		const env = await seed(makeEnv);
		await page.goto(`${env.dashboardUrl}/#/attempts?t=paso.js&k=run_script`);
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await expect(
			page.getByRole("region", { name: "Cambios de Script" }),
		).toContainText("// ahora cambia");
	});
});

test("E91 · a 390 px la página no hace scroll horizontal, y el diff lo hace dentro de su caja", async ({
	page,
	makeEnv,
}) => {
	const env = await seed(makeEnv);
	await page.setViewportSize({ width: 390, height: 800 });
	await page.goto(`${env.dashboardUrl}/#/attempts`);
	await expect(
		page.getByRole("button", { name: "paso.js", exact: true }),
	).toBeVisible();
	const overflows = () =>
		page.locator("html").evaluate((el) => el.scrollWidth > el.clientWidth);
	expect(await overflows()).toBe(false);
	await page.getByRole("button", { name: "paso.js", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "Cambios de Script" }),
	).toBeVisible();
	expect(await overflows()).toBe(false);
});
