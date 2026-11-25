// El hilo del chat pegado al final sigue pegado cuando cambia el alto de su caja (la captura de Playwright redimensiona
// la ventana un instante y la caja cambia de alto): el navegador acota el scroll al encoger la caja y nada lo volvía a pegar al crecer
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const GROW_PX = 22;
const AT_BOTTOM_PX = 1;

const firstThread = (page: Page): Locator =>
	page
		.locator("section[aria-labelledby='g-chatthread']")
		.getByRole("feed")
		.first();
const distanceFromBottom = (feed: Locator) =>
	feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

test("un hilo pegado al final vuelve al final tras crecer y encoger su caja", async ({
	page,
	galleryUrl,
}) => {
	await page.goto(`${galleryUrl}/#/components?s=organisms`);
	const feed = firstThread(page);
	await expect(feed).toBeVisible();
	await expect
		.poll(() => distanceFromBottom(feed))
		.toBeLessThanOrEqual(AT_BOTTOM_PX);

	// En un mismo pintado crece un poco (el navegador acota el scroll) y vuelve a su alto: nadie ve el alto intermedio
	await feed.evaluate((el, grow) => {
		const box = el.closest("section")?.parentElement;
		if (box === null || box === undefined) return;
		box.style.height = `${box.clientHeight + grow}px`;
		el.scrollHeight;
		box.style.height = "";
	}, GROW_PX);

	await expect
		.poll(() => distanceFromBottom(feed))
		.toBeLessThanOrEqual(AT_BOTTOM_PX);
	await expect(feed).toHaveAttribute("data-settled", "true");
});
