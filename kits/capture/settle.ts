// Carga y espera: `settle` (fuentes, transiciones
// fuera, imágenes y pósteres de vídeo), `backgrounds` (fondos con imagen decodificados para `backgroundImage`), `strip`
// (quitar lo que no se captura) y `until` (sondear una condición con plazo).
import type { KitEnv } from "./pieces.ts";

// Tiempos del capturador: el respiro tras cargar las fuentes y tras una acción, y el sondeo de una condición
export const SETTLE_MS = 300;
export const POLL_MS = 50;

const NO_MOTION =
	"*,*::before,*::after{transition:none!important;animation:none!important}";

export const sleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

// Espera a las imágenes pendientes, como mucho `timeoutMs`; devuelve cuántas siguen sin cargar
async function waitImages(doc: Document, timeoutMs: number): Promise<number> {
	const pending = [...doc.images].filter((im) => !im.complete);
	await Promise.race([
		Promise.all(
			pending.map(
				(im) =>
					new Promise((r) => {
						im.onload = im.onerror = r;
					}),
			),
		),
		sleep(timeoutMs),
	]);
	return [...doc.images].filter((im) => !im.complete).length;
}

export async function settle(
	env: KitEnv,
	options: { readonly imgTimeoutMs: number },
): Promise<{ readonly pendingImages: number }> {
	const { doc } = env;
	// Las perezosas a «eager»: si no, la espera se queda colgada con las que no se ven
	for (const im of doc.querySelectorAll("img[loading=lazy]"))
		(im as HTMLImageElement).loading = "eager";
	await doc.fonts.ready;
	await sleep(SETTLE_MS);
	const st = doc.createElement("style");
	st.textContent = NO_MOTION;
	doc.head.appendChild(st);
	await waitImages(doc, options.imgTimeoutMs);
	// vídeo de otro origen (no rasterizable): su poster como <img> con las mismas clases
	for (const v of [...doc.querySelectorAll("video[poster]")]) {
		const im = doc.createElement("img");
		im.className = v.className;
		im.setAttribute("style", v.getAttribute("style") || "");
		im.alt = "";
		im.src = (v as HTMLVideoElement).poster;
		v.replaceWith(im);
	}
	return { pendingImages: await waitImages(doc, options.imgTimeoutMs) };
}

// Quita del documento lo que casa con los selectores (y, si se pide, la barra de desplazamiento)
export function strip(
	doc: Document,
	selectors: readonly string[],
	hideScrollbar: boolean,
): number {
	let removed = 0;
	for (const sel of selectors)
		for (const n of doc.querySelectorAll(sel)) {
			n.remove();
			removed++;
		}
	if (hideScrollbar) doc.documentElement.style.scrollbarWidth = "none";
	return removed;
}

// Los fondos con url(…) decodificados, para pintarlos como imagen al recorrer
export async function backgrounds(env: KitEnv): Promise<void> {
	const { win, doc, bg } = env;
	bg.clear();
	for (const el of doc.body.querySelectorAll("*")) {
		const m = /url\((["']?)(.*?)\1\)/.exec(
			win.getComputedStyle(el).backgroundImage,
		);
		if (!m) continue;
		const im = new Image();
		im.src = new URL(m[2] as string, win.location.href).href;
		try {
			await im.decode();
			bg.set(el, im);
		} catch {
			/* imagen no cargable */
		}
	}
}

// Sondea `check` hasta que es verdadera o vence el plazo
export async function until(
	check: () => unknown,
	timeoutMs: number,
): Promise<boolean> {
	const t0 = performance.now();
	for (;;) {
		if (await check()) return true;
		if (performance.now() - t0 >= timeoutMs) return false;
		await sleep(POLL_MS);
	}
}
