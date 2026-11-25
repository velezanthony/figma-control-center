// Modo del panel: por defecto (producción) la galería de componentes no se ofrece ni se abre; su ruta cae en el inicio
import { expect, test } from "./fixtures.ts";

test("en producción «Componentes» no está en la barra lateral y #/components abre el inicio", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	// Se espera a que la web sepa el modo: antes de saberlo también esconde la galería
	const modeKnown = page.waitForResponse((r) =>
		r.url().endsWith("/api/settings/list"),
	);
	await page.goto(`${env.dashboardUrl}/#/components`);
	await modeKnown;
	const nav = page.getByRole("navigation", { name: "Secciones" });
	await expect(nav.getByRole("link", { name: /Ajustes/ })).toBeVisible();
	await expect(nav.getByRole("link", { name: /Componentes/ })).toHaveCount(0);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inicio");
	await expect(page.locator("section[aria-labelledby^='g-']")).toHaveCount(0);
});
