// E6 · la tabla de Actividad: búsqueda, filtros, orden, paginación, fila desplegada y estado en la URL tras recargar

import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { expect, test } from "./fixtures.ts";

const ERRORS = 5;
const READS = 9;
const WRITES = 1;
const TOTAL = ERRORS + READS + WRITES;
const PER_PAGE = 10;

const args = (scenario: keyof typeof SCENARIOS) => {
	const s = SCENARIOS[scenario];
	return { file: scenarioPath(s.script), format: s.format };
};

test("E6 · búsqueda, filtro, orden, paginación y fila abierta viven en la URL y sobreviven a recargar", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	for (let i = 0; i < ERRORS; i++)
		await claude.callTool(TOOL_NAME.runScript, args("errorRuntime"));
	for (let i = 0; i < READS; i++)
		await claude.callTool(TOOL_NAME.runScript, args("readValue"));
	for (let i = 0; i < WRITES; i++)
		await claude.callTool(TOOL_NAME.runScript, args("writeCreated"));

	await page.goto(`${env.dashboardUrl}/#/activity`);
	const rows = page
		.getByRole("table", { name: "Llamadas a las herramientas" })
		.locator("tbody tr");
	const count = page.getByText(/^Mostrando /);
	await expect(count).toHaveText(`Mostrando 1-${TOTAL} de ${TOTAL} resultados`);

	// Búsqueda: filtra en el servidor y se escribe en la URL
	await page
		.getByRole("searchbox", { name: "Buscar en la actividad" })
		.fill("error-runtime");
	await expect(rows).toHaveCount(ERRORS);
	await expect(page).toHaveURL(/[?&]q=error-runtime/);

	// Filtro de estado
	await page
		.getByRole("searchbox", { name: "Buscar en la actividad" })
		.fill("");
	await expect(rows).toHaveCount(TOTAL);
	await page.getByRole("button", { name: "Estado: todas" }).click();
	await page.getByRole("menuitemradio", { name: "Con error" }).click();
	await expect(rows).toHaveCount(ERRORS);
	await expect(page).toHaveURL(/[?&]status=error/);
	await page.getByRole("button", { name: /^Estado:/ }).click();
	await page.getByRole("menuitemradio", { name: "Todas" }).click();
	await expect(rows).toHaveCount(TOTAL);

	// Orden por duración: la cabecera lo anuncia y las filas lo cumplen
	await page
		.getByRole("columnheader", { name: "Duración" })
		.getByRole("button")
		.click();
	await expect(page).toHaveURL(/[?&]sort=duration/);
	const header = page.getByRole("columnheader", { name: "Duración" });
	const direction = await header.getAttribute("aria-sort");
	expect(["ascending", "descending"]).toContain(direction);
	const ms = (await rows.locator("td:nth-child(4)").allInnerTexts()).map((t) =>
		Number.parseInt(t, 10),
	);
	const sorted = [...ms].sort((a, b) =>
		direction === "ascending" ? a - b : b - a,
	);
	expect(ms).toEqual(sorted);

	// Paginación
	await page
		.getByRole("combobox", { name: "Mostrar" })
		.selectOption(String(PER_PAGE));
	await expect(rows).toHaveCount(PER_PAGE);
	await expect(count).toHaveText(
		`Mostrando 1-${PER_PAGE} de ${TOTAL} resultados`,
	);
	await page.getByRole("button", { name: "Página 2" }).click();
	await expect(rows).toHaveCount(TOTAL - PER_PAGE);
	await expect(page).toHaveURL(/[?&]page=2/);

	// Fila desplegada
	await rows.first().getByRole("button", { name: "Ver detalle" }).click();
	await expect(page).toHaveURL(/[?&]open=/);
	await expect(page.getByRole("heading", { name: "Argumentos" })).toBeVisible();

	// Recargar (F5): el mismo estado, sin tocar nada
	await page.reload();
	await expect(page).toHaveURL(/[?&]sort=duration/);
	await expect(page).toHaveURL(/[?&]page=2/);
	await expect(page).toHaveURL(/[?&]per=10/);
	await expect(page.getByRole("combobox", { name: "Mostrar" })).toHaveValue(
		String(PER_PAGE),
	);
	await expect(count).toHaveText(
		`Mostrando 11-${TOTAL} de ${TOTAL} resultados`,
	);
	await expect(page.getByRole("heading", { name: "Argumentos" })).toBeVisible();
	await expect(
		page.getByRole("columnheader", { name: "Duración" }),
	).toHaveAttribute("aria-sort", direction ?? "");
});
