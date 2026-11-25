// E31 los menores del panel (CP-10): Jobs enseña el manifiesto o «N pasos · fichero»; las sesiones del chat no se
// piden con cada evento de actividad; «Proyectos» no mezcla filas y aviso de lista vacía; ningún campo sin id ni name;
// el título de la pestaña lleva el nombre de la pantalla.
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;
const SESSIONS_PATH = "/api/chat/sessions";
const BATCH_MS = 10_000;
const MAX_SESSION_REQUESTS = 6;
const EVENT_EVERY_MS = 150;

const step = (key: "buildStepOkA" | "buildStepOkB" | "buildStepSlow") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

test("E31 · Jobs enseña «N pasos · fichero» en un lote por steps", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepOkB")],
	});
	await claude.waitJob(String(started.out["jobId"]));

	await page.goto(`${env.dashboardUrl}/#/jobs`);
	const row = page.getByRole("row").filter({ hasText: "2 pasos" });
	await expect(row).toContainText(
		`2 pasos · ${scenarioPath(SCENARIOS.buildStepOkA.script)}`,
	);
});

test("E31 · Jobs enseña el manifiesto de un lote por manifest", async ({
	page,
	makeEnv,
}) => {
	const dir = await mkdtemp(join(tmpdir(), "figma-manifest-"));
	try {
		await copyFile(
			scenarioPath(SCENARIOS.buildStepOkA.script),
			join(dir, SCENARIOS.buildStepOkA.script),
		);
		await writeFile(
			join(dir, "lote.json"),
			JSON.stringify({ steps: [{ file: SCENARIOS.buildStepOkA.script }] }),
		);
		const env = await makeEnv({ scriptsRoot: dir });
		const claude = await env.startClaude({ reply: null });
		const started = await claude.callTool(TOOL_NAME.build, {
			manifest: join(dir, "lote.json"),
		});
		await claude.waitJob(String(started.out["jobId"]));

		await page.goto(`${env.dashboardUrl}/#/jobs`);
		await expect(
			page.getByRole("row").filter({ hasText: "lote.json" }),
		).toContainText(join(dir, "lote.json"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("E31 · durante un lote de 10 s las sesiones del chat no se piden con cada evento", async ({
	page,
	makeEnv,
}) => {
	test.setTimeout(60_000);
	const env = await makeEnv();
	const claude = await env.startClaude({ reply: null });
	let sessionRequests = 0;
	page.on("request", (r) => {
		if (new URL(r.url()).pathname === SESSIONS_PATH) sessionRequests++;
	});
	await page.goto(`${env.dashboardUrl}/#/jobs`);

	const started = await claude.callTool(TOOL_NAME.build, {
		steps: [step("buildStepOkA"), step("buildStepSlow")],
	});
	const jobId = String(started.out["jobId"]);
	await until(
		"el paso lento está en curso",
		() => env.simulator?.waiting(SLOW_GATE) === 1,
	);
	sessionRequests = 0;

	// Un evento de actividad cada pocos cientos de ms durante el lote
	const end = Date.now() + BATCH_MS;
	while (Date.now() < end) {
		await claude.callTool(TOOL_NAME.getJob, { jobId });
		await page.waitForTimeout(EVENT_EVERY_MS);
	}
	await releaseGate(env.simulator, SLOW_GATE);
	await claude.waitJob(jobId);

	expect(sessionRequests).toBeLessThanOrEqual(MAX_SESSION_REQUESTS);
});

test("E31 · «Proyectos» con solo la fila del .env no enseña el aviso de lista vacía", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	await page.goto(`${env.dashboardUrl}/#/projects`);
	await expect(
		page.getByRole("list", { name: "Proyectos registrados" }),
	).toBeVisible();
	await expect(
		page.getByText("Todavía no has dado de alta ningún proyecto"),
	).toHaveCount(0);
});

const PAGES = ["", "activity", "jobs", "captures", "chat", "projects"];

test("E31 · ningún campo del panel sale sin id ni name", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ figma: "down" });
	const anonymous = async () =>
		page
			.locator("input:not([type=hidden]), select, textarea")
			.evaluateAll((els) =>
				els
					.filter((el) => !el.getAttribute("id") && !el.getAttribute("name"))
					.map((el) => el.outerHTML.slice(0, 120)),
			);
	for (const route of PAGES) {
		await page.goto(`${env.dashboardUrl}/#/${route}`);
		await page.waitForLoadState("networkidle");
		expect(await anonymous(), `página «${route || "inicio"}»`).toEqual([]);
	}
	await page.goto(`${env.dashboardUrl}/#/projects`);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Nuevo proyecto" })
		.first()
		.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	expect(await anonymous(), "formulario de Proyectos").toEqual([]);
});

test("E31 · el título de la pestaña sigue a la pantalla al navegar", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	await page.goto(`${env.dashboardUrl}/#/jobs`);
	await expect(page).toHaveTitle("Jobs · Figma Control Center");
	await page.getByRole("link", { name: "Ajustes" }).first().click();
	await expect(page).toHaveTitle("Ajustes · Figma Control Center");
});
