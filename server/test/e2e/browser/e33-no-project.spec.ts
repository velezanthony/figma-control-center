// E33 el panel sin proyecto (ninguno creado): «Inicio» y «Proyectos» funcionan; «Actividad», «Jobs», «Capturas» y «Chat»
// se ven deshabilitadas en la barra con su motivo; la URL directa a una de ellas enseña el aviso con enlace a
// «Proyectos»; el selector vacío lleva a «Proyectos». Un proyecto dado de alta las habilita.
import { join } from "node:path";
import type { Environment } from "../../harness/environment.ts";
import { expect, test } from "./fixtures.ts";

const HINT = "Crea o elige un proyecto para ver esto";
const NEED_PROJECT = ["Actividad", "Jobs", "Capturas", "Chat"] as const;

async function emptyEnv(
	makeEnv: (o?: { figma: "down"; projects: [] }) => Promise<Environment>,
): Promise<Environment> {
	return makeEnv({ figma: "down", projects: [] });
}

test("E33 · la barra deshabilita las pantallas de datos con su motivo y deja Inicio, Proyectos y Ayuda", async ({
	page,
	makeEnv,
}) => {
	const env = await emptyEnv(makeEnv);
	await page.goto(env.dashboardUrl);
	const nav = page.getByRole("navigation", { name: "Secciones" });
	for (const name of NEED_PROJECT) {
		const item = nav.getByRole("link", { name, exact: true });
		await expect(item).toBeDisabled();
		await expect(item).toHaveAccessibleDescription(HINT);
	}
	await nav.getByRole("link", { name: "Actividad", exact: true }).hover();
	await expect(page.getByRole("tooltip")).toContainText(HINT);
	for (const name of ["Inicio", "Proyectos"]) {
		await expect(nav.getByRole("link", { name, exact: true })).toBeEnabled();
	}
	// La ayuda no depende de ningún proyecto (va fuera de las secciones de datos)
	await expect(
		page.getByRole("link", { name: "Ayuda", exact: true }),
	).toBeEnabled();
	// Pulsar una deshabilitada no cambia de pantalla
	await nav
		.getByRole("link", { name: "Jobs", exact: true })
		.click({ force: true });
	await expect(page).not.toHaveURL(/#\/jobs/);
});

test("E33 · la URL directa a una pantalla de datos enseña el aviso con un enlace a Proyectos", async ({
	page,
	makeEnv,
}) => {
	const env = await emptyEnv(makeEnv);
	for (const route of ["activity", "jobs", "captures", "chat"]) {
		await page.goto(`${env.dashboardUrl}/#/${route}`);
		await expect(
			page.getByRole("main").getByText(HINT, { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Ir a Proyectos" }),
		).toBeVisible();
	}
	await page.getByRole("link", { name: "Ir a Proyectos" }).click();
	await expect(page).toHaveURL(/#\/projects/);
	await expect(
		page.getByRole("heading", { name: "Proyectos" }).first(),
	).toBeVisible();
});

test("E33 · el selector vacío lleva a Proyectos", async ({ page, makeEnv }) => {
	const env = await emptyEnv(makeEnv);
	await page.goto(env.dashboardUrl);
	await page.getByRole("link", { name: "Sin proyectos: crear uno" }).click();
	await expect(page).toHaveURL(/#\/projects/);
});

test("E33 · al dar de alta un proyecto las pantallas se habilitan", async ({
	page,
	makeEnv,
}) => {
	const env = await emptyEnv(makeEnv);
	await page.goto(env.dashboardUrl);
	const saved = await fetch(`${env.dashboardUrl}/api/projects/save`, {
		method: "POST",
		headers: { Origin: env.dashboardUrl, "Content-Type": "application/json" },
		body: JSON.stringify({
			entry: {
				name: "Nuevo",
				projectDir: env.dir,
				fileUrl: env.fileUrl,
				outputDir: join(env.dir, "nuevo-salida"),
			},
		}),
	});
	expect(saved.status).toBe(200);
	await page.reload();
	const nav = page.getByRole("navigation", { name: "Secciones" });
	for (const name of NEED_PROJECT) {
		await expect(nav.getByRole("link", { name, exact: true })).toBeEnabled();
	}
});
