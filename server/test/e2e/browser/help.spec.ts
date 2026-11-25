// Ayuda: el glosario dejó Inicio. Un enlace guardado al de antes y el del chat llegan a Ayuda → Glosario con su grupo
import { expect, test } from "./fixtures.ts";

const pressed = (page: import("@playwright/test").Page, name: string) =>
	page
		.getByRole("group", { name: "Filtrar por grupo" })
		.getByRole("button", { name, exact: true });

test("un enlace antiguo al glosario de Inicio se reescribe a Ayuda con su grupo", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	await page.goto(`${env.dashboardUrl}/#/?glossary=tools`);
	await expect(page).toHaveURL(/#\/help\?tab=glossary&group=tools$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ayuda");
	await expect(page.getByRole("tab", { name: "Glosario" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(pressed(page, "Herramientas")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.getByRole("heading", { level: 2 })).toHaveText([
		"Herramientas",
	]);
});

test("«Ayuda» abre «Cómo funciona» y el glosario busca y filtra", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	await page.goto(env.dashboardUrl);
	await page.getByRole("link", { name: "Ayuda", exact: true }).click();
	await expect(page).toHaveURL(/#\/help$/);
	await expect(page.getByRole("heading", { name: "Qué es" })).toBeVisible();
	await page.getByRole("tab", { name: "Glosario" }).click();
	await expect(page).toHaveURL(/#\/help\?tab=glossary$/);
	await page
		.getByRole("searchbox", { name: "Buscar en el glosario" })
		.fill("pestana de figma");
	await expect(page.locator("dt > span")).toHaveText(["Sin pestaña de Figma"]);
	await pressed(page, "Herramientas").click();
	await expect(page).toHaveURL(/#\/help\?tab=glossary&group=tools$/);
	await expect(page.getByText("Ningún término coincide")).toBeVisible();
});
