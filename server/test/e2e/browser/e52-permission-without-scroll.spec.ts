// E52 las peticiones de permiso van DENTRO de la conversación, en su orden por hora: con una petición de figma_build
// (descripción real y tres pasos con rutas largas) el único scroll vertical de la página es el de la conversación y
// no hay scroll horizontal. Los parámetros van en JSON de una línea que se ajusta; si no caben en seis líneas se
// recortan con «Ver todo». Con la petición pendiente fuera de la vista, un aviso sobre el campo de escribir lleva a ella.

import type { Locator, Page } from "@playwright/test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { liveSessionId, seedChat } from "../../harness/seed-chat.ts";
import { until } from "../../harness/wait.ts";
import { waitForChatSettled } from "./chat-settled.ts";
import { expect, test } from "./fixtures.ts";

// La ventana en la que el dueño midió los tres scrolls anidados, y una más alta
const VIEWPORTS = [
	{ width: 1280, height: 690 },
	{ width: 1280, height: 850 },
] as const;
const LONG_DIR =
	"/home/usuario/proyectos/ejemplo/scripts/componentes/formularios/campos-de-texto";
const step = (file: string) => ({
	file: `${LONG_DIR}/${file}`,
	format: "body",
});
const BUILD_INPUT = JSON.stringify({
	steps: [
		step("01-crear-variables-de-color-y-tipografia.js"),
		step("02-construir-variantes-del-campo-con-estados.js"),
		step("03-montar-la-ficha-de-documentacion-del-componente.js"),
	],
	stopOnError: true,
});
// Un lote largo: no cabe en seis líneas
const LONG_BUILD_INPUT = JSON.stringify({
	steps: Array.from({ length: 12 }, (_, i) =>
		step(
			`${String(i + 1).padStart(2, "0")}-paso-del-lote-con-un-nombre-largo.js`,
		),
	),
	stopOnError: true,
});
const LATER_MESSAGE = "Mensaje posterior a la petición";
const EARLY_MESSAGES = 6;
// Para el aviso: suficientes mensajes para dejar la petición muy lejos al subir
const MANY_MESSAGES = 60;
const MESSAGE_AFTER_MS = 60_000;

const feedOf = (page: Page) =>
	page.getByRole("feed", { name: "Conversación con Claude" });
const cardOf = (page: Page, tool: string) =>
	page.getByRole("article", { name: `Claude pide permiso para usar ${tool}` });

// Los elementos de la página con scroll vertical de verdad (overflow auto/scroll y contenido que no cabe). Va como
// texto: el tsconfig de los tests no tiene DOM
// La navegación lateral (overflow-y-auto por diseño) puede desplazarse sola en una ventana baja: no es el scroll de la página
const VERTICAL_SCROLLERS = `[...document.querySelectorAll("body *")]
	.filter((el) => {
		if (el.closest("aside")) return false;
		const { overflowY } = getComputedStyle(el);
		return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight;
	})
	.map((el) => el.getAttribute("aria-label") ?? el.tagName.toLowerCase())`;
const verticalScrollers = (page: Page) =>
	page.evaluate<string[]>(VERTICAL_SCROLLERS);
const horizontalOverflow = (target: Locator) =>
	target.evaluate((el) => el.scrollWidth - el.clientWidth);

// Un mensaje con hora posterior a la petición, directo en la base
function insertLaterMessage(
	env: { exec: (sql: string) => void },
	sessionId: string,
) {
	env.exec(
		`INSERT INTO chat_messages(project_id, session_id, direction, chat_id, body, at, status, sender_hash) VALUES (1, '${sessionId}', 'in', 'despues', '${LATER_MESSAGE}', ${Date.now() + MESSAGE_AFTER_MS}, 'delivered', NULL)`,
	);
}

for (const viewport of VIEWPORTS) {
	test(`E52 · ${viewport.width}x${viewport.height}: la petición de figma_build va dentro de la conversación, en su orden, y la conversación es el único scroll`, async ({
		page,
		makeEnv,
	}) => {
		await page.setViewportSize(viewport);
		const env = await makeEnv({ chatAgent: true, reply: null });
		const claude = await env.startClaude();
		const sessionId = liveSessionId(env);
		seedChat(env, sessionId, { count: EARLY_MESSAGES });
		const description = await claude.toolDescription(TOOL_NAME.build);
		await claude.askPermission({
			toolName: TOOL_NAME.build,
			description,
			inputPreview: BUILD_INPUT,
		});
		await until(
			"queda guardada",
			() => env.rows("SELECT 1 FROM permission_requests").length === 1,
		);
		insertLaterMessage(env, sessionId);

		await page.goto(`${env.dashboardUrl}/#/chat`);
		const feed = feedOf(page);
		const card = cardOf(page, TOOL_NAME.build);
		await expect(card).toBeVisible();
		await waitForChatSettled(page);

		// Dentro del scroller de la conversación y entre el último mensaje sembrado y el posterior
		await expect(
			feed.locator("article", { has: page.getByText(description) }),
		).toHaveCount(1);
		const order = await feed.evaluate((el) =>
			[...el.querySelectorAll("[data-key]")].map(
				(row) => row.textContent ?? "",
			),
		);
		const cardAt = order.findIndex((t) => t.includes("Claude pide permiso"));
		const lastSeededAt = order.findIndex((t) =>
			t.includes(`Respuesta número ${EARLY_MESSAGES - 1}`),
		);
		const laterAt = order.findIndex((t) => t.includes(LATER_MESSAGE));
		expect(
			lastSeededAt,
			"el último mensaje sembrado está montado",
		).toBeGreaterThan(-1);
		expect(cardAt, "la tarjeta va después del último mensaje anterior").toBe(
			lastSeededAt + 1,
		);
		expect(laterAt, "y antes del mensaje posterior").toBe(cardAt + 1);

		// Un solo scroll vertical, el de la conversación; ninguno horizontal
		expect(await verticalScrollers(page)).toEqual(["Conversación con Claude"]);
		expect(await horizontalOverflow(page.locator("html"))).toBeLessThanOrEqual(
			0,
		);
		expect
			.soft(await horizontalOverflow(card.locator("pre")))
			.toBeLessThanOrEqual(0);

		// Parámetros en JSON compacto, de una línea que se ajusta al ancho
		await expect(card.locator("pre")).toContainText('"stopOnError":true');

		// «Ver más» despliega la descripción completa y «Ver menos» la recoge
		const more = card.getByRole("button", { name: "Ver más" });
		await expect(more).toHaveAttribute("aria-expanded", "false");
		await more.focus();
		await page.keyboard.press("Enter");
		const less = card.getByRole("button", { name: "Ver menos" });
		await expect(less).toHaveAttribute("aria-expanded", "true");
		const full = await card
			.getByText(description)
			.evaluate((el) => el.scrollHeight <= el.clientHeight);
		expect(full).toBe(true);
		await less.click();
		await expect(more).toHaveAttribute("aria-expanded", "false");
	});
}

test("E52 · unos parámetros que no caben en seis líneas se recortan con «Ver todo» y «Copiar» copia el valor entero", async ({
	page,
	context,
	makeEnv,
}) => {
	await page.setViewportSize(VIEWPORTS[0]);
	const env = await makeEnv({ chatAgent: true, reply: null });
	await context.grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: env.dashboardUrl,
	});
	const claude = await env.startClaude();
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await claude.askPermission({
		toolName: TOOL_NAME.build,
		description: "Lote largo",
		inputPreview: LONG_BUILD_INPUT,
	});
	const card = cardOf(page, TOOL_NAME.build);
	const params = card.locator("pre code");
	await expect(params).toBeVisible();
	const clipped = () =>
		params.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
	expect(await clipped()).toBe(true);

	const all = card.getByRole("button", { name: "Ver todo" });
	await expect(all).toHaveAttribute("aria-expanded", "false");
	await all.focus();
	await page.keyboard.press("Enter");
	const less = card.getByRole("button", { name: "Ver menos" });
	await expect(less).toHaveAttribute("aria-expanded", "true");
	await expect.poll(clipped).toBe(false);
	expect(await verticalScrollers(page)).not.toContain("pre");

	await card.getByRole("button", { name: "Copiar" }).click();
	expect(await page.evaluate<string>("navigator.clipboard.readText()")).toBe(
		LONG_BUILD_INPUT,
	);
	await less.click();
	await expect(all).toHaveAttribute("aria-expanded", "false");
});

test("E52 · con la petición pendiente fuera de la vista sale un aviso; «Ver» la trae y le da el foco; contestada, el aviso se va", async ({
	page,
	makeEnv,
}) => {
	await page.setViewportSize(VIEWPORTS[0]);
	const env = await makeEnv({ chatAgent: true, reply: null });
	const claude = await env.startClaude();
	seedChat(env, liveSessionId(env), { count: MANY_MESSAGES });
	await page.goto(`${env.dashboardUrl}/#/chat`);
	const feed = feedOf(page);
	await expect(
		feed.getByText(`Respuesta número ${MANY_MESSAGES - 1}`),
	).toBeVisible();

	// Llega una petición con la vista abajo: la conversación baja hasta ella y no hace falta aviso
	await claude.askPermission({
		toolName: "Bash",
		description: "Lista los archivos",
		inputPreview: '{"command":"ls"}',
	});
	const card = cardOf(page, "Bash");
	await expect(card).toBeInViewport();
	await waitForChatSettled(page);
	const notice = page.getByRole("button", { name: "Ver", exact: true });
	await expect(page.getByText("1 permiso esperando")).toHaveCount(0);

	// El usuario sube a leer el historial: la pendiente queda fuera y sale el aviso
	await feed.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect(page.getByText("1 permiso esperando")).toBeVisible();

	// «Ver» la trae a la vista y le da el foco
	await notice.click();
	await expect(card).toBeInViewport();
	await expect(card).toBeFocused();
	await expect(page.getByText("1 permiso esperando")).toHaveCount(0);

	// Contestada (desde arriba otra vez), el aviso no vuelve
	await card.getByRole("button", { name: "Aprobar" }).click();
	await expect(card.getByText("Aprobada")).toBeVisible();
	await feed.evaluate((el) => {
		el.scrollTop = 0;
	});
	await waitForChatSettled(page);
	await expect(page.getByText(/permisos? esperando/)).toHaveCount(0);
});
