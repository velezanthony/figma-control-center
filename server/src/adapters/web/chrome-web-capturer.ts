// El capturador de serie, lado del servidor: por cada llamada lanza el Chrome de captura
// (D-6), abre un contexto de navegador por usuario (los públicos, en uno sin sesión), entra por el formulario si hace
// falta y, por pantalla y variante: navegar → settle + ready + strip (kit) → acciones y until → capture (kit) →
// imágenes a ficheros. Lo cierra todo al acabar, también si falla.
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type {
	CapturedScreen,
	CaptureUser,
	WebCaptureRequest,
	WebCapturer,
} from "#application/ports/web-capturer.ts";
import type { CaptureWarning, Screen } from "#domain/capture.ts";
import {
	type FigmaError,
	WEB_PAGE_REASON,
	webPageError,
} from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { variantPath } from "#domain/screen-url.ts";
import { type CaptureChrome, launchCaptureChrome } from "./capture-chrome.ts";
import { CapturePage } from "./capture-page.ts";
import type { OutgoingMessage } from "./cdp-connection.ts";
import { extractImages } from "./images.ts";
import { CDP, KIT_BUNDLE, TIMING } from "./protocol.ts";

export type ChromeWebCapturerOptions = {
	readonly bin: string;
	readonly port: number;
	readonly profileDir: string;
	readonly kitBundle?: string;
	readonly trace?: (m: OutgoingMessage) => void;
};

type KitWarning = { readonly message: string };

// Los públicos primero (sin sesión) y después un grupo por usuario, en el orden en que aparecen
function bySession(screens: readonly Screen[]): Map<string | null, Screen[]> {
	const groups = new Map<string | null, Screen[]>();
	for (const s of screens) {
		const key = s.session ?? null;
		groups.set(key, [...(groups.get(key) ?? []), s]);
	}
	const publicScreens = groups.get(null);
	if (publicScreens === undefined) return groups;
	groups.delete(null);
	return new Map([[null, publicScreens], ...groups]);
}

export class ChromeWebCapturer implements WebCapturer {
	readonly #options: ChromeWebCapturerOptions;

	constructor(options: ChromeWebCapturerOptions) {
		this.#options = options;
	}

	async capture(
		request: WebCaptureRequest,
		onScreen: (screen: CapturedScreen) => Promise<void>,
	): Promise<Result<true, FigmaError>> {
		let kitSource: string;
		try {
			kitSource = await readFile(this.#options.kitBundle ?? KIT_BUNDLE, "utf8");
		} catch {
			return err(
				webPageError(
					WEB_PAGE_REASON.load,
					`no está el kit empaquetado (${KIT_BUNDLE}): npm run build:kit`,
				),
			);
		}
		const launched = await launchCaptureChrome({
			bin: this.#options.bin,
			port: this.#options.port,
			profileDir: this.#options.profileDir,
			screenScale: request.web.screenScale,
			viewport: request.web.viewport,
			timeoutMs: request.pageTimeoutMs,
			// Con pseudoclases forzadas el Chrome tiene que decir que hay un ratón
			pointerDevice: request.screens.some((s) =>
				(s.variants ?? []).some((v) => (v.force ?? []).length > 0),
			),
			...(this.#options.trace !== undefined && { trace: this.#options.trace }),
		});
		if (!launched.ok) return launched;
		const chrome = launched.value;
		try {
			for (const [session, screens] of bySession(request.screens)) {
				const user = session === null ? null : request.users.get(session);
				if (user === undefined)
					return err(
						webPageError(
							WEB_PAGE_REASON.login,
							`sin usuario para la sesión «${session}»`,
						),
					);
				const done = await this.#group(
					chrome,
					kitSource,
					request,
					screens,
					user,
					onScreen,
				);
				if (!done.ok) return done;
			}
			return ok(true);
		} finally {
			await chrome.close();
		}
	}

	async #group(
		chrome: CaptureChrome,
		kitSource: string,
		request: WebCaptureRequest,
		screens: readonly Screen[],
		user: CaptureUser | null,
		onScreen: (screen: CapturedScreen) => Promise<void>,
	): Promise<Result<true, FigmaError>> {
		const session = await openCaptureSession(chrome, kitSource, request, user);
		if (!session.ok) return session;
		try {
			let prepared = false;
			for (const screen of screens) {
				const captured = await captureScreen(
					session.value.page,
					request,
					screen,
					!prepared,
				);
				if (!captured.ok) return captured;
				prepared = true;
				await onScreen(captured.value);
			}
			return ok(true);
		} finally {
			await session.value.close();
		}
	}
}

// Un contexto de navegador propio (cookies aparte) con su pestaña, los ganchos y, si hay usuario, la sesión iniciada
export async function openCaptureSession(
	chrome: CaptureChrome,
	kitSource: string,
	request: WebCaptureRequest,
	user: CaptureUser | null,
): Promise<
	Result<{ readonly page: CapturePage; close(): Promise<void> }, FigmaError>
> {
	const { browserContextId } = (await chrome.cdp.send(
		CDP.createBrowserContext,
		{
			disposeOnDetach: true,
		},
	)) as { browserContextId: string };
	const close = () =>
		chrome.cdp
			.send(CDP.disposeBrowserContext, { browserContextId })
			.then(() => undefined)
			.catch(() => undefined);
	const fail = async (e: FigmaError) => {
		await close();
		return err(e);
	};
	const opened = await CapturePage.open(chrome, {
		baseUrl: request.web.baseUrl,
		viewport: request.web.viewport,
		devicePixelRatio: request.web.devicePixelRatio,
		timeoutMs: request.pageTimeoutMs,
		kitSource,
		browserContextId,
	});
	if (!opened.ok) return fail(opened.error);
	const page = opened.value;
	if (request.hooks !== null) {
		const hooked = await page.useHooks(request.hooks);
		if (!hooked.ok) return fail(hooked.error);
	}
	if (user !== null) {
		if (request.web.login === null)
			return fail(
				webPageError(
					WEB_PAGE_REASON.login,
					"la pantalla pide sesión y project@1 no tiene web.login",
				),
			);
		const logged = await page.login(
			request.web.login,
			user.username,
			user.password,
		);
		if (!logged.ok) return fail(logged.error);
	}
	return ok({ page, close });
}

// Una pantalla con el capturador de serie: por variante, navegar → settle + ready + strip → acciones y until → capture
// Con `viewport` en la pantalla, la pestaña cambia de tamaño solo para ella y vuelve al de project@1 al acabar
export async function captureScreen(
	page: CapturePage,
	request: WebCaptureRequest,
	screen: Screen,
	prepare: boolean,
): Promise<Result<CapturedScreen, FigmaError>> {
	// El tamaño de la pestaña de ahora; lo cambian la pantalla (al empezar) y las variantes que piden otro
	const view = { current: request.web.viewport };
	if (screen.viewport !== undefined) {
		const resized = await page.setViewport(screen.viewport);
		if (!resized.ok) return resized;
		view.current = screen.viewport;
	}
	try {
		return await captureVariants(page, request, screen, prepare, view);
	} finally {
		const project = request.web.viewport;
		if (view.current.w !== project.w || view.current.h !== project.h)
			await page.setViewport(project);
	}
}

async function captureVariants(
	page: CapturePage,
	request: WebCaptureRequest,
	screen: Screen,
	prepare: boolean,
	view: { current: { readonly w: number; readonly h: number } },
): Promise<Result<CapturedScreen, FigmaError>> {
	const variants: CapturedScreen["variants"][number][] = [];
	const images = new Map<string, CapturedScreen["images"][number]>();
	const warnings: CaptureWarning[] = [];
	let url = "";
	// El tamaño de la pestaña de ahora: el de la pantalla (o el de project@1) y, solo en su variante, el de la variante
	const base = screen.viewport ?? request.web.viewport;
	for (const [i, variant] of (screen.variants ?? [{ props: {} }]).entries()) {
		const wanted = variant.viewport ?? base;
		if (wanted.w !== view.current.w || wanted.h !== view.current.h) {
			const resized = await page.setViewport(wanted);
			if (!resized.ok) return resized;
			view.current = wanted;
		}
		const target = {
			screen: { key: screen.key, title: screen.title, url: screen.url },
			variant: { props: variant.props },
			allowPageWorld: request.allowPageWorld,
		};
		const loaded = await page.navigate(variantPath(screen.url, variant.query));
		if (!loaded.ok) return loaded;
		url = loaded.value;
		if (prepare && i === 0) {
			const prepared = await page.kit("prepare", target);
			if (!prepared.ok) return prepared;
		}
		const ready = await page.kit("ready", {
			...target,
			strip: request.web.strip,
			hideScrollbar: request.web.hideScrollbar,
			imgTimeoutMs: request.pageTimeoutMs,
		});
		if (!ready.ok) return ready;
		warnings.push(
			...((ready.value as { warnings: KitWarning[] }).warnings ?? []),
		);
		for (const action of variant.run ?? []) {
			const done =
				"click" in action
					? await page.click(action.click)
					: await page.evaluateInPage(action.evaluateInPage);
			if (!done.ok) return done;
		}
		if ((variant.run ?? []).length > 0) await sleep(TIMING.afterActionMs);
		for (const condition of [screen.until, variant.until]) {
			if (condition === undefined) continue;
			const reached = await page.until(condition, request.pageTimeoutMs);
			if (!reached.ok) return reached;
		}
		// Pseudoclases forzadas: después de las acciones y antes de medir; se quitan al acabar la variante
		if ((variant.force ?? []).length > 0) {
			const forced = await page.force(variant.force ?? []);
			if (!forced.ok) {
				await page.clearForced();
				return forced;
			}
		}
		const out = await page.kit("capture", {
			...target,
			pick: screen.pick,
			imgHi: true,
		});
		if ((variant.force ?? []).length > 0) await page.clearForced();
		if (!out.ok) return out;
		const raw = out.value as { nodes: unknown[]; warnings: KitWarning[] };
		const extracted = extractImages(raw.nodes);
		for (const image of extracted.images) images.set(image.sha256, image);
		warnings.push(...raw.warnings, ...extracted.warnings);
		variants.push({ props: variant.props, nodes: extracted.nodes });
	}
	return ok({
		key: screen.key,
		url,
		variants,
		images: [...images.values()],
		warnings,
	});
}
