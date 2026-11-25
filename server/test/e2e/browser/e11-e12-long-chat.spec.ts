// E11 conversación larga (2.000 mensajes sembrados): DOM acotado, sin saltos y pegado al final ·
// E12 búsqueda propia: Ctrl/Cmd+F encuentra un mensaje antiguo sin cargar, salta a él y lo resalta
import type { Locator, Page } from "@playwright/test";
import { DEFAULT_REPLY } from "../../harness/fake-claude.ts";
import { liveSessionId, seedChat } from "../../harness/seed-chat.ts";
import { waitForChatSettled } from "./chat-settled.ts";
import { expect, test } from "./fixtures.ts";

const MESSAGES = 2000;
const NEEDLE = "zafiro-antiguo-7731";
const NEEDLE_AT = 6;
// Lo que se monta a la vez (la pantalla más el colchón): lejos de los 2.000 mensajes
const MAX_MOUNTED_MESSAGES = 80;
// Nodos del documento entero con la lista montada: sin virtualizar, 2.000 mensajes con Markdown pasan de 30.000
const MAX_DOM_NODES = 4000;
const JUMP_TOLERANCE_PX = 3;
const AT_BOTTOM_PX = 4;
const SCROLL_UP_PX = 1500;
const REPLY_DELAY_MS = 1500;
const WHEEL_PX = 250;
const WHEEL_STEPS = 60;

const feedOf = (page: Page) =>
	page.getByRole("feed", { name: "Conversación con Claude" });
const mounted = (feed: Locator) => feed.getByRole("article");
const domNodes = (page: Page) =>
	page
		.locator("html")
		.evaluate((root) => root.getElementsByTagName("*").length);
const distanceFromBottom = (feed: Locator) =>
	feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

async function openLongChat(
	page: Page,
	env: Awaited<
		ReturnType<Parameters<Parameters<typeof test>[2]>[0]["makeEnv"]>
	>,
) {
	seedChat(env, liveSessionId(env), {
		count: MESSAGES,
		needle: { at: NEEDLE_AT, text: NEEDLE },
	});
	await page.goto(`${env.dashboardUrl}/#/chat`);
	const feed = feedOf(page);
	await expect(feed).toBeVisible();
	return feed;
}

test("E11 · 2.000 mensajes: el DOM sigue acotado mientras se sube, sin saltos", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ chatAgent: true, reply: null });
	await env.startClaude({ reply: null });
	const feed = await openLongChat(page, env);

	// Abre pegado al final y con lo mínimo montado
	await expect(
		feed.getByText(`Respuesta número ${MESSAGES - 1}`),
	).toBeVisible();
	expect(await distanceFromBottom(feed)).toBeLessThan(AT_BOTTOM_PX);
	expect(await mounted(feed).count()).toBeLessThan(MAX_MOUNTED_MESSAGES);
	expect(await domNodes(page)).toBeLessThan(MAX_DOM_NODES);

	// Sube a trompicones hasta el principio: cada tramo anterior se carga y el DOM no crece
	let peakMounted = 0;
	let peakNodes = 0;
	const sizeOf = async () =>
		Number(await mounted(feed).first().getAttribute("aria-setsize"));
	let lastSize = await sizeOf();
	for (let step = 0; step < 60 && lastSize < MESSAGES; step++) {
		await feed.evaluate((el) => {
			el.scrollTop = 0;
		});
		await expect.poll(sizeOf, { timeout: 10_000 }).toBeGreaterThan(lastSize);
		lastSize = await sizeOf();
		peakMounted = Math.max(peakMounted, await mounted(feed).count());
		peakNodes = Math.max(peakNodes, await domNodes(page));
	}
	expect(lastSize).toBe(MESSAGES);
	expect(peakMounted).toBeLessThan(MAX_MOUNTED_MESSAGES);
	expect(peakNodes).toBeLessThan(MAX_DOM_NODES);
	// El anclaje de la lista puede recolocar el scroll tras la última carga: se insiste hasta llegar arriba
	await expect(async () => {
		await feed.evaluate((el) => {
			el.scrollTop = 0;
		});
		await expect(feed.getByText(/Pregunta número 0(?!\d)/).first()).toBeVisible(
			{ timeout: 1000 },
		);
	}).toPass();
});

test("E11 · subiendo con la rueda, cada mensaje se desplaza exactamente lo que se rueda, también cuando se cargan los anteriores", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ chatAgent: true, reply: null });
	await env.startClaude({ reply: null });
	const feed = await openLongChat(page, env);
	await expect(
		feed.getByText(`Respuesta número ${MESSAGES - 1}`),
	).toBeVisible();
	const box = await feed.boundingBox();
	await page.mouse.move(
		(box?.x ?? 0) + (box?.width ?? 0) / 2,
		(box?.y ?? 0) + (box?.height ?? 0) / 2,
	);

	// El mensaje que cruza el centro de la lista y dónde está
	const centre = () =>
		feed.evaluate((el) => {
			const view = el.getBoundingClientRect();
			const middle = view.top + view.height / 2;
			for (const article of el.querySelectorAll("[role=article]")) {
				const r = article.getBoundingClientRect();
				if (r.top <= middle && r.bottom >= middle)
					return { key: article.getAttribute("data-key"), top: r.top };
			}
			return null;
		});
	const topOf = (key: string) =>
		feed.evaluate(
			(el, k) =>
				el.querySelector(`[data-key="${k}"]`)?.getBoundingClientRect().top ??
				null,
			key,
		);

	let loadedOlder = false;
	const sizeAtStart = Number(
		await mounted(feed).first().getAttribute("aria-setsize"),
	);
	for (let step = 0; step < WHEEL_STEPS; step++) {
		const before = await centre();
		if (before?.key == null) continue;
		const scrolled = await feed.evaluate((el) => el.scrollTop);
		await page.mouse.wheel(0, -WHEEL_PX);
		// El navegador aplica la rueda y el anclaje en el siguiente pintado
		await waitForChatSettled(page);
		const after = await topOf(before.key);
		if (scrolled > WHEEL_PX * 2 && after !== null) {
			expect(
				Math.abs(after - before.top - WHEEL_PX),
				`paso ${step}: el mensaje ${before.key} saltó`,
			).toBeLessThanOrEqual(JUMP_TOLERANCE_PX);
		}
		loadedOlder ||=
			Number(await mounted(feed).first().getAttribute("aria-setsize")) >
			sizeAtStart;
	}
	expect(loadedOlder, "durante la prueba se cargaron mensajes anteriores").toBe(
		true,
	);
});

test("E11 · pegado al final: una respuesta nueva se ve; si el usuario subió, no lo mueve", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({
		chatAgent: true,
		reply: { ...DEFAULT_REPLY, delayMs: REPLY_DELAY_MS },
	});
	await env.startClaude();
	const feed = await openLongChat(page, env);
	await expect(
		feed.getByText(`Respuesta número ${MESSAGES - 1}`),
	).toBeVisible();

	// Abajo: llega la respuesta y sigue abajo
	await page
		.getByRole("textbox", { name: "Mensaje para Claude" })
		.fill("primera");
	await page.keyboard.press("Enter");
	await expect(feed.getByText("Hoy hubo")).toBeVisible();
	await expect.poll(() => distanceFromBottom(feed)).toBeLessThan(AT_BOTTOM_PX);

	// Arriba: el usuario sube; la siguiente respuesta llega pero no lo arrastra, y ofrece «Ir al final»
	await page
		.getByRole("textbox", { name: "Mensaje para Claude" })
		.fill("segunda");
	await page.keyboard.press("Enter");
	await feed.evaluate((el, delta) => {
		el.scrollTop = el.scrollTop - delta;
	}, SCROLL_UP_PX);
	await waitForChatSettled(page);
	// Lo que se está leyendo (el mensaje que cruza el centro) y dónde está, antes de que llegue la respuesta
	const reading = await feed.evaluate((el) => {
		const view = el.getBoundingClientRect();
		const middle = view.top + view.height / 2;
		for (const article of el.querySelectorAll("[role=article]")) {
			const r = article.getBoundingClientRect();
			if (r.top <= middle && r.bottom >= middle)
				return { key: article.getAttribute("data-key"), top: r.top };
		}
		return null;
	});
	expect(reading).not.toBeNull();
	await expect
		.poll(
			() =>
				env.rows(
					"SELECT 1 FROM chat_messages WHERE direction = 'out' AND chat_id NOT LIKE 'seed-%'",
				).length,
		)
		.toBe(2);
	await waitForChatSettled(page);
	const after =
		(await feed.locator(`[data-key="${reading?.key}"]`).boundingBox())?.y ??
		Number.NaN;
	expect(Math.abs(after - (reading?.top ?? Number.NaN))).toBeLessThanOrEqual(
		JUMP_TOLERANCE_PX,
	);
	await expect(page.getByRole("button", { name: "Ir al final" })).toBeVisible();
});

test("E12 · Ctrl+F abre nuestra barra, encuentra un mensaje antiguo sin cargar, salta a él y lo resalta; Escape devuelve el foco", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ chatAgent: true, reply: null });
	await env.startClaude({ reply: null });
	const feed = await openLongChat(page, env);
	await expect(
		feed.getByText(`Respuesta número ${MESSAGES - 1}`),
	).toBeVisible();

	// El mensaje buscado no está montado ni cargado
	await expect(feed.getByText(NEEDLE)).toHaveCount(0);
	const composer = page.getByRole("textbox", { name: "Mensaje para Claude" });
	await composer.focus();

	await page.keyboard.press("Control+f");
	const search = page.getByRole("search");
	await expect(search).toBeVisible();
	const field = search.getByRole("searchbox", {
		name: "Buscar en la conversación",
	});
	await expect(field).toBeFocused();
	await field.fill(NEEDLE);
	await expect(
		search.getByText("1 de 1", { exact: true }).first(),
	).toBeVisible();

	// Salta al mensaje antiguo y lo resalta
	const mark = feed.locator("mark", { hasText: NEEDLE });
	await expect(mark).toBeVisible();
	await expect(mounted(feed).filter({ hasText: NEEDLE })).toHaveCount(1);
	expect(await mounted(feed).count()).toBeLessThan(MAX_MOUNTED_MESSAGES);

	// Escape cierra la barra y devuelve el foco a donde estaba
	await page.keyboard.press("Escape");
	await expect(search).toHaveCount(0);
	await expect(composer).toBeFocused();
});
