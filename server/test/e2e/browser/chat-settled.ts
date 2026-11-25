// Espera a que las listas del chat hayan medido y colocado su scroll (`data-settled` de VirtualList), en vez de un
// tiempo fijo. Dos pintados antes de mirar: el navegador aplica la rueda y el anclaje en el siguiente
import type { Page } from "@playwright/test";

const TWO_FRAMES =
	"new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))";
const ALL_SETTLED =
	"[...document.querySelectorAll('[role=feed][data-settled]')].every((feed) => feed.getAttribute('data-settled') === 'true')";

export async function waitForChatSettled(page: Page): Promise<void> {
	await page.evaluate(TWO_FRAMES);
	await page.waitForFunction(ALL_SETTLED);
}
