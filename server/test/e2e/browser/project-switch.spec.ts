// Cambiar de proyecto en el selector deja la pantalla y quita la vista del anterior (sesión, fila abierta, página).
import { expect, test } from "./fixtures.ts";

test("cambiar de proyecto conserva la pantalla y quita los parámetros de vista", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
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
	await page.goto(`${env.dashboardUrl}/#/activity?session=ab12&open=c9&page=3`);
	const selector = page.getByRole("combobox", { name: "Proyecto activo" });
	await expect(selector.locator("option")).toHaveCount(2);
	await selector.selectOption({ label: "Otro" });
	await expect.poll(() => new URL(page.url()).hash).toBe("#/activity");
	expect(new URL(page.url()).searchParams.get("project")).not.toBeNull();
});

test("el nombre largo de un proyecto se lee entero al pasar o enfocar y como descripción accesible", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	const name = "figma-control-center-con-un-nombre-largo-de-verdad";
	const created = await page.request.post(
		`${env.dashboardUrl}/api/projects/save`,
		{
			data: {
				entry: {
					name,
					projectDir: "/tmp/largo",
					fileUrl: "https://www.figma.com/design/ABC123/Largo",
				},
			},
		},
	);
	expect(created.ok()).toBe(true);
	await page.goto(`${env.dashboardUrl}/#/activity`);
	const selector = page.getByRole("combobox", { name: "Proyecto activo" });
	await selector.selectOption({ label: name });
	await expect(selector).toHaveAccessibleDescription(name);

	await page.mouse.move(600, 400);
	await expect(
		page.getByRole("tooltip").filter({ hasText: name }),
	).toBeHidden();
	await selector.hover();
	await expect(
		page.getByRole("tooltip").filter({ hasText: name }),
	).toBeVisible();

	await page.mouse.move(600, 400);
	await selector.focus();
	await expect(
		page.getByRole("tooltip").filter({ hasText: name }),
	).toBeVisible();
});

test("un fallo al cargar la lista de proyectos no borra el ?project de la URL", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	await page.route("**/api/projects/list", (route) => route.abort());
	await page.goto(`${env.dashboardUrl}/?project=elegido#/activity`);
	// La lista no llega; damos tiempo a que la carga fallida termine
	await expect(page.getByRole("heading", { name: "Actividad" })).toBeVisible();
	await page.waitForLoadState("networkidle");
	expect(new URL(page.url()).searchParams.get("project")).toBe("elegido");
});

test("un 500 al cargar la lista no la vacía ni cambia el proyecto", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	await page.route("**/api/projects/list", (route) =>
		route.fulfill({ status: 500, body: "" }),
	);
	await page.goto(`${env.dashboardUrl}/?project=elegido#/activity`);
	await page.waitForLoadState("networkidle");
	expect(new URL(page.url()).searchParams.get("project")).toBe("elegido");
});
