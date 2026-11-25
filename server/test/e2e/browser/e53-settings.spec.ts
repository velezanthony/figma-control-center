// E53 la pantalla «Ajustes»: se abre sin ningún proyecto, un valor se guarda y la fila lo dice
// (y que hasta reiniciar el panel no se aplica), uno inválido enseña el motivo debajo del campo, lo que fija el entorno
// sale en solo lectura y «Restablecer» vuelve al valor por defecto.
import { expect, test } from "./fixtures.ts";

// Lo usan el panel y el agente, y el arnés no lo fija en el entorno (FCC_HISTORY_STEP_EXCERPT_BYTES, 300 por defecto)
const EXCERPT = "Extracto de cada paso de un lote";
// FCC_BUILD_MAX_STEPS, que esta prueba fija en el entorno del panel
const STEPS = "Pasos por lote";

test("E53 · Ajustes: guardar, error de un valor inválido, entorno en solo lectura y restablecer", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({
		figma: "down",
		projects: [],
		extraEnv: { FCC_BUILD_MAX_STEPS: "30" },
	});
	await page.goto(env.dashboardUrl);
	const nav = page.getByRole("navigation", { name: "Secciones" });
	await expect(
		nav.getByRole("link", { name: "Ajustes", exact: true }),
	).toBeEnabled();
	await nav.getByRole("link", { name: "Ajustes", exact: true }).click();
	await expect(page).toHaveURL(/#\/settings/);
	await expect(
		page.getByRole("heading", { name: "Ajustes" }).first(),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "Histórico" })).toBeVisible();

	const excerpt = page.getByRole("group", { name: EXCERPT, exact: true });
	const field = excerpt.getByRole("textbox", { name: EXCERPT, exact: true });
	await expect(field).toHaveValue("300");
	await expect(excerpt.getByText("Por defecto", { exact: true })).toBeVisible();
	await expect(
		excerpt.getByRole("button", { name: "Restablecer" }),
	).toHaveCount(0);

	// Guardar un valor válido
	const save = excerpt.getByRole("button", { name: "Guardar" });
	await expect(save).toBeDisabled();
	await field.fill("77");
	await expect(save).toBeEnabled();
	await save.click();
	await expect(
		excerpt.getByText("Guardado en el panel", { exact: true }),
	).toBeVisible();
	await expect(field).toHaveValue("77");
	await expect(save).toBeDisabled();
	await expect(excerpt.getByText("Pendiente: reinicia el panel")).toBeVisible();
	await expect(
		excerpt.getByText(
			"Se aplica al próximo agente que lances y al reiniciar el panel",
		),
	).toBeVisible();

	// Un valor inválido: el motivo sale debajo del campo y no se guarda
	await field.fill("0");
	await excerpt.getByRole("button", { name: "Guardar" }).click();
	await expect(excerpt.getByRole("alert")).toHaveText(
		"Tiene que ser un número entero mayor que 0.",
	);
	await expect(field).toHaveAttribute("aria-invalid", "true");
	await expect(
		excerpt.getByText("Guardado en el panel", { exact: true }),
	).toBeVisible();

	// Lo que fija el entorno: solo lectura y sin «Guardar»
	const steps = page.getByRole("group", { name: STEPS, exact: true });
	const stepsField = steps.getByRole("textbox", { name: STEPS, exact: true });
	await expect(stepsField).toHaveValue("30");
	await expect(stepsField).toHaveAttribute("readonly", "");
	await expect(
		steps.getByText("Fijado en el entorno", { exact: true }),
	).toBeVisible();
	await expect(steps.getByRole("button", { name: "Guardar" })).toHaveCount(0);

	// Restablecer vuelve al valor por defecto y quita el error
	await expect(excerpt.getByText("Vuelve a 300")).toBeVisible();
	await excerpt.getByRole("button", { name: "Restablecer" }).click();
	await expect(excerpt.getByText("Por defecto", { exact: true })).toBeVisible();
	await expect(field).toHaveValue("300");
	await expect(excerpt.getByRole("alert")).toHaveCount(0);
	await expect(
		excerpt.getByRole("button", { name: "Restablecer" }),
	).toHaveCount(0);

	// «Restablecer todo»: desactivado sin nada guardado; con algo guardado pide confirmar (cancelar no borra, confirmar sí)
	const resetAll = page.getByRole("button", { name: "Restablecer todo" });
	await expect(resetAll).toBeDisabled();
	await field.fill("88");
	await save.click();
	await expect(
		excerpt.getByText("Guardado en el panel", { exact: true }),
	).toBeVisible();
	await expect(resetAll).toBeEnabled();
	await resetAll.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("1 ajuste");
	await expect(dialog).toContainText(EXCERPT);
	await dialog.getByRole("button", { name: "Cancelar" }).click();
	await expect(field).toHaveValue("88");
	await resetAll.click();
	await dialog.getByRole("button", { name: "Restablecer todo" }).click();
	await expect(field).toHaveValue("300");
	await expect(excerpt.getByText("Por defecto", { exact: true })).toBeVisible();
	await expect(resetAll).toBeDisabled();
});

test("E53 · Ajustes: los campos están alineados (mismo ancho) y el móvil no desborda", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down", projects: [] });
	await page.goto(`${env.dashboardUrl}#/settings`);
	await expect(page.getByRole("heading", { name: "Histórico" })).toBeVisible();
	const fields = page.getByRole("textbox");
	const count = await fields.count();
	expect(count).toBeGreaterThan(10);
	const boxes = await fields.evaluateAll((els) =>
		els.map((el) => {
			const r = el.getBoundingClientRect();
			return { width: Math.round(r.width), left: Math.round(r.left) };
		}),
	);
	expect(new Set(boxes.map((b) => b.width)).size).toBe(1);
	expect(new Set(boxes.map((b) => b.left)).size).toBe(1);

	await page.setViewportSize({ width: 390, height: 800 });
	const overflow = await page
		.locator("html")
		.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});
