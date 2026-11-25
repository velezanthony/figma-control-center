// Teclado en la galería: en cada componente con elementos enfocables, Tab los recorre en el orden del documento, el
// foco se ve siempre (anillo de enfoque) y no queda ninguno inaccesible. Más los comportamientos propios de cada
// patrón (menú con flechas y Escape, pestañas con flechas, tooltip con foco, desplegable con Intro y Espacio).
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const TABS = ["atoms", "molecules", "organisms"] as const;
const SECTIONS = "section[aria-labelledby^='g-']";
// Lo que el navegador mete en el orden de tabulación (los que tienen tabindex="-1" o están deshabilitados, no)
// Con tablas de decenas de filas, los primeros topes ya prueban el orden y el anillo; el resto solo alarga la prueba
const MAX_STOPS_PER_SECTION = 30;
const KEYBOARD_TEST_TIMEOUT_MS = 180_000;
const NOT_ROVING = ":not([tabindex='-1'])";
const TABBABLE = [
	`a[href]${NOT_ROVING}`,
	`button:not([disabled])${NOT_ROVING}`,
	`input:not([disabled]):not([type=hidden])${NOT_ROVING}`,
	`select:not([disabled])${NOT_ROVING}`,
	`textarea:not([disabled])${NOT_ROVING}`,
	`[tabindex]${NOT_ROVING}`,
].join(", ");

// El anillo puede estar en el propio elemento o en el contenedor que se ilumina con el foco dentro (campos de texto)
const ANCESTOR_LEVELS = 4;
// Sin anillo, Tailwind deja --tw-ring-shadow en su valor inicial: la sombra de elevación de tarjetas y campos no cuenta
const NO_RING = "0 0 #0000";
const focusStyle = (target: Locator) =>
	target.evaluate(
		(el, { levels, noRing }) => {
			const view = el.ownerDocument.defaultView;
			let node: typeof el | null = el;
			for (let i = 0; i <= levels && node !== null; i++) {
				const style = view?.getComputedStyle(node);
				const outline =
					style?.outlineStyle !== "none" &&
					Number.parseFloat(style?.outlineWidth ?? "0") > 0;
				const ring = (style?.getPropertyValue("--tw-ring-shadow") ?? "").trim();
				const shadow = ring !== "" && ring !== noRing;
				if (outline || shadow) return { outline, shadow };
				node = node.parentElement as typeof el | null;
			}
			return { outline: false, shadow: false };
		},
		{ levels: ANCESTOR_LEVELS, noRing: NO_RING },
	);

async function visibleTabbables(section: Locator): Promise<Locator[]> {
	const all = (await section.locator(TABBABLE).all()).slice(
		0,
		MAX_STOPS_PER_SECTION * 2,
	);
	const kept: Locator[] = [];
	for (const el of all) {
		// Lo que está dentro de un flotante cerrado ([popover]) o de un padre oculto no es tabulable
		if (await el.isVisible()) kept.push(el);
		if (kept.length >= MAX_STOPS_PER_SECTION) break;
	}
	return kept;
}

const isFocused = (target: Locator) =>
	target.evaluate((el) => el === el.ownerDocument.activeElement);

async function open(page: Page, url: string, tab: string): Promise<void> {
	await page.goto(`${url}/#/components?s=${tab}`);
	await expect(page.locator(SECTIONS).first()).toBeVisible();
}

for (const tab of TABS) {
	test(`teclado · ${tab}: Tab recorre cada componente en orden y el foco se ve`, async ({
		page,
		galleryUrl,
	}) => {
		test.setTimeout(KEYBOARD_TEST_TIMEOUT_MS);
		await open(page, galleryUrl, tab);
		const sections = page.locator(SECTIONS);
		const count = await sections.count();
		const problems: string[] = [];
		for (let i = 0; i < count; i++) {
			const section = sections.nth(i);
			const id =
				(await section.getAttribute("aria-labelledby")) ?? `seccion-${i}`;
			const stops = await visibleTabbables(section);
			if (stops.length === 0) continue;
			// Entra en el componente como lo haría el teclado: desde su título, con Tab (enfocar el primer elemento por código no es lo mismo)
			await section.locator(`#${id}`).evaluate((heading) => {
				heading.setAttribute("tabindex", "-1");
				(heading as unknown as { focus(): void }).focus();
			});
			await page.keyboard.press("Tab");
			for (let n = 0; n < stops.length; n++) {
				const stop = stops[n] as Locator;
				if (!(await isFocused(stop))) {
					problems.push(
						`${id}: el tope ${n + 1} de ${stops.length} no recibió el foco en orden`,
					);
					break;
				}
				const style = await focusStyle(stop);
				if (!(style.outline || style.shadow)) {
					problems.push(`${id}: el tope ${n + 1} no muestra anillo de foco`);
				}
				await page.keyboard.press("Tab");
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});
}

test("teclado · menú de filtro: abre, flechas, Inicio/Fin, Escape y el foco vuelve al disparador", async ({
	page,
	galleryUrl,
}) => {
	await open(page, galleryUrl, "molecules");
	const section = page.locator("section[aria-labelledby='g-filterdd']");
	const trigger = section.getByRole("button").first();
	await trigger.focus();
	await page.keyboard.press("Enter");
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	const items = menu.getByRole("menuitemradio");
	await expect(items.first()).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(items.nth(1)).toBeFocused();
	await page.keyboard.press("End");
	await expect(items.last()).toBeFocused();
	await page.keyboard.press("Home");
	await expect(items.first()).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();
	await expect(trigger).toBeFocused();
});

test("teclado · grupo de pestañas: las flechas cambian de pestaña y solo una está en el orden de Tab", async ({
	page,
	galleryUrl,
}) => {
	await open(page, galleryUrl, "molecules");
	const group = page
		.locator("section[aria-labelledby='g-tabgroup']")
		.getByRole("tablist")
		.first();
	const tabs = group.getByRole("tab");
	const selected = group.getByRole("tab", { selected: true });
	await selected.focus();
	const before = await tabs.evaluateAll((all) =>
		all.findIndex((t) => t.getAttribute("aria-selected") === "true"),
	);
	await page.keyboard.press("ArrowRight");
	await expect(tabs.nth((before + 1) % (await tabs.count()))).toBeFocused();
	await expect(group.locator("[role=tab][tabindex='0']")).toHaveCount(1);
});

test("teclado · desplegable: Intro y Espacio lo abren y lo cierran", async ({
	page,
	galleryUrl,
}) => {
	await open(page, galleryUrl, "molecules");
	const toggle = page
		.locator("section[aria-labelledby='g-disclosure'] button[aria-expanded]")
		// la primera de la galería viene abierta; la segunda, cerrada por defecto
		.nth(1);
	await toggle.focus();
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("Space");
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("teclado · tooltip: el foco lo muestra y salir del foco lo oculta", async ({
	page,
	galleryUrl,
}) => {
	await open(page, galleryUrl, "atoms");
	const section = page.locator("section[aria-labelledby='g-tooltip']");
	const trigger = section.locator("[tabindex='0'], button").first();
	await trigger.focus();
	await expect(
		page.getByRole("tooltip").filter({ hasText: /\S/ }).first(),
	).toBeVisible();
	await trigger.blur();
	await expect(
		page.getByRole("tooltip").filter({ hasText: /\S/ }).first(),
	).toBeHidden();
});
