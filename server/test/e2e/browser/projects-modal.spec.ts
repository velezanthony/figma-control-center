// Modal de Proyectos (alta, edición y borrado): Escape y fondo durante un guardado, foco y accesibilidad.
// Los guardados se retienen con page.route para poder pulsar Escape mientras el servidor aún no ha contestado.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const FILE_URL = "https://www.figma.com/design/ABC123/Prueba";

function gate(): { wait: Promise<void>; release: () => void } {
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { wait, release };
}

async function openNew(page: Page): Promise<void> {
	await page
		.getByRole("main")
		.getByRole("button", { name: "Nuevo proyecto" })
		.first()
		.click();
}

async function fillValid(page: Page): Promise<void> {
	await page
		.getByRole("textbox", { name: "Nombre", exact: true })
		.fill("Prueba");
	await page
		.getByRole("textbox", { name: "Directorio del proyecto" })
		.fill("/tmp/prueba");
	await page.getByRole("textbox", { name: /^Archivo de Figma/ }).fill(FILE_URL);
}

test("Escape durante un guardado no cierra el formulario y el error sigue visible", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	const held = gate();
	await page.route("**/api/projects/save", async (route) => {
		await held.wait;
		await route.fulfill({
			status: 500,
			json: { ok: false, error: { message: "disco lleno" } },
		});
	});
	await page.goto(`${env.dashboardUrl}/#/projects`);
	await openNew(page);
	await fillValid(page);
	await page.getByRole("button", { name: "Guardar" }).click();
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	held.release();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.getByRole("dialog").getByText("disco lleno")).toBeVisible();
	// Y se puede cerrar con normalidad una vez libre
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();
});

test("Escape durante un borrado no cierra el aviso y el error sigue visible", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	const created = await page.request.post(
		`${env.dashboardUrl}/api/projects/save`,
		{
			data: {
				entry: {
					name: "Sobrante",
					projectDir: "/tmp/sobrante",
					fileUrl: FILE_URL,
				},
			},
		},
	);
	expect(created.ok()).toBe(true);
	const held = gate();
	await page.route("**/api/projects/delete", async (route) => {
		await held.wait;
		await route.fulfill({
			status: 500,
			json: { ok: false, error: { message: "registro bloqueado" } },
		});
	});
	await page.goto(`${env.dashboardUrl}/#/projects`);
	await page
		.getByRole("listitem")
		.filter({ hasText: "Sobrante" })
		.getByRole("button", { name: "Borrar" })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Borrar", exact: true })
		.click();
	await page.keyboard.press("Escape");
	held.release();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(
		page.getByRole("dialog").getByText("registro bloqueado"),
	).toBeVisible();
});

async function createProject(page: Page, base: string, name: string) {
	const created = await page.request.post(`${base}/api/projects/save`, {
		data: {
			entry: { name, projectDir: `/tmp/${name}`, fileUrl: FILE_URL },
		},
	});
	expect(created.ok()).toBe(true);
}

test.describe("accesibilidad del modal de Proyectos", () => {
	test("el diálogo tiene nombre, el foco empieza en el primer campo y vuelve al botón al cerrar", async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: "down" });
		await page.goto(`${env.dashboardUrl}/#/projects`);
		const opener = page
			.getByRole("main")
			.getByRole("button", { name: "Nuevo proyecto" })
			.first();
		await opener.focus();
		await page.keyboard.press("Enter");
		const dialog = page.getByRole("dialog", { name: "Nuevo proyecto" });
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole("textbox", { name: "Nombre", exact: true }),
		).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(opener).toBeFocused();
	});

	test("los obligatorios son required y cada error se anuncia y queda enlazado a su campo", async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: "down" });
		await page.goto(`${env.dashboardUrl}/#/projects`);
		await openNew(page);
		const dialog = page.getByRole("dialog", { name: "Nuevo proyecto" });
		const name = dialog.getByRole("textbox", { name: "Nombre", exact: true });
		const dir = dialog.getByRole("textbox", {
			name: "Directorio del proyecto",
		});
		const url = dialog.getByRole("textbox", { name: /^Archivo de Figma/ });
		for (const field of [name, dir, url])
			await expect(field).toHaveJSProperty("required", true);

		await dialog.getByRole("button", { name: "Guardar" }).click();
		await expect(dialog.getByRole("alert")).toHaveText(
			"El nombre es obligatorio.",
		);
		await expect(name).toHaveAttribute("aria-invalid", "true");
		await expect(name).toHaveAccessibleDescription("El nombre es obligatorio.");
		await expect(name).toBeFocused();

		await name.fill("Prueba");
		await dialog.getByRole("button", { name: "Guardar" }).click();
		await expect(dialog.getByRole("alert")).toHaveText(
			"El directorio del proyecto es obligatorio.",
		);
		await expect(name).not.toHaveAttribute("aria-invalid", "true");
		await expect(dir).toHaveAttribute("aria-invalid", "true");
		await expect(dir).toHaveAccessibleDescription(
			"El directorio del proyecto es obligatorio.",
		);
	});

	test("soltar un arrastre de selección sobre el fondo no cierra; un clic en el fondo sí", async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: "down" });
		await page.goto(`${env.dashboardUrl}/#/projects`);
		await openNew(page);
		const dialog = page.getByRole("dialog");
		const name = dialog.getByRole("textbox", { name: "Nombre", exact: true });
		await name.fill("texto seleccionable");
		const box = await name.boundingBox();
		if (box === null) throw new Error("el campo no tiene caja");
		await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(5, 5);
		await page.mouse.up();
		await expect(dialog).toBeVisible();
		await page.mouse.click(5, 5);
		await expect(dialog).toBeHidden();
	});

	test("al borrar, el foco empieza en Cancelar y acaba en la lista, no en el body", async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: "down" });
		await createProject(page, env.dashboardUrl, "Sobrante");
		await page.goto(`${env.dashboardUrl}/#/projects`);
		await page
			.getByRole("listitem")
			.filter({ hasText: "Sobrante" })
			.getByRole("button", { name: "Borrar" })
			.click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("button", { name: "Cancelar" }),
		).toBeFocused();
		await dialog.getByRole("button", { name: "Borrar", exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(
			page.getByRole("listitem").filter({ hasText: "Sobrante" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("list", { name: "Proyectos registrados" }),
		).toBeFocused();
	});

	test("con la barra contraída el selector de proyecto se alcanza con teclado, tiene nombre y cambia de proyecto", async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: "down" });
		await createProject(page, env.dashboardUrl, "Otro");
		await page.goto(`${env.dashboardUrl}/#/activity`);
		await page
			.getByRole("button", { name: "Contraer la barra lateral" })
			.click();
		const selector = page.getByRole("combobox", { name: "Proyecto activo" });
		await selector.focus();
		await expect(selector).toBeFocused();
		await selector.selectOption({ label: "Otro" });
		await expect.poll(() => page.url()).toContain("project=");
		await expect(selector.locator("option:checked")).toHaveText("Otro");
	});
});

test.describe("formulario de Proyectos: confirmación y errores", () => {
	test("editar la raíz de scripts después de pedir la confirmación la pide otra vez", async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: "down" });
		await page.goto(`${env.dashboardUrl}/#/projects`);
		await openNew(page);
		await fillValid(page);
		const dialog = page.getByRole("dialog");
		const roots = dialog.getByRole("textbox", { name: /^Raíz de scripts/ });
		await roots.fill("/tmp/scripts-a");
		await dialog.getByRole("button", { name: "Guardar" }).click();
		await expect(
			dialog.getByText(/Vas a fijar la raíz de scripts/),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Confirmar y guardar" }),
		).toBeVisible();

		await roots.fill("/tmp/scripts-b");
		await expect(
			dialog.getByText(/Vas a fijar la raíz de scripts/),
		).toBeHidden();
		await expect(dialog.getByRole("button", { name: "Guardar" })).toBeVisible();
	});

	test("el error de un modal no aparece en el otro", async ({
		page,
		makeEnv,
	}) => {
		const env = await makeEnv({ figma: "down" });
		await createProject(page, env.dashboardUrl, "Uno");
		await page.route("**/api/projects/delete", (route) =>
			route.fulfill({
				status: 500,
				json: { ok: false, error: { message: "registro bloqueado" } },
			}),
		);
		await page.goto(`${env.dashboardUrl}/#/projects`);
		const row = page.getByRole("listitem").filter({ hasText: "Uno" });
		const dialog = page.getByRole("dialog");

		// Un error del formulario no se ve al abrir el aviso de borrar
		await openNew(page);
		await dialog.getByRole("button", { name: "Guardar" }).click();
		await expect(dialog.getByRole("alert")).toBeVisible();
		await page.keyboard.press("Escape");
		await row.getByRole("button", { name: "Borrar" }).click();
		await expect(dialog.getByRole("alert")).toHaveCount(0);

		// Y el error del borrado no se ve al abrir el formulario
		await dialog.getByRole("button", { name: "Borrar", exact: true }).click();
		await expect(dialog.getByText("registro bloqueado")).toBeVisible();
		await dialog.getByRole("button", { name: "Cancelar" }).click();
		await expect(dialog).toBeHidden();
		await openNew(page);
		await expect(dialog.getByRole("alert")).toHaveCount(0);
	});
});
