// La pestaña de captura dentro del Chrome de captura: viewport emulado con el
// devicePixelRatio del proyecto, guarda de navegación bajo baseUrl (una navegación de la pestaña que sale se corta con
// Fetch y es WebPageError), el kit en un MUNDO AISLADO, clics, `until` con plazo, `evaluateInPage` en el mundo de la
// página y el login por formulario con la contraseña como ARGUMENTO de Runtime.callFunctionOn, nunca en un texto.
import { setTimeout as sleep } from "node:timers/promises";
import {
	type FigmaError,
	stateNotReached,
	WEB_PAGE_REASON,
	webPageError,
} from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { CaptureChrome } from "./capture-chrome.ts";
import type { CdpConnection, CdpEvent } from "./cdp-connection.ts";
import { CDP, KIT_GLOBAL, KIT_WORLD, TIMING } from "./protocol.ts";

export type CapturePageOptions = {
	readonly baseUrl: string;
	readonly viewport: { readonly w: number; readonly h: number };
	readonly devicePixelRatio: number;
	readonly timeoutMs: number;
	// El kit empaquetado, como texto
	readonly kitSource: string;
	// Un contexto de navegador propio (cookies aparte); sin él, el de por defecto del Chrome de captura
	readonly browserContextId?: string | undefined;
};

export type LoginForm = {
	readonly path: string;
	readonly fields: { readonly user: string; readonly password: string };
	readonly submit?: string | undefined;
};

type EvalReply = {
	readonly result?: { readonly value?: unknown };
	readonly exceptionDetails?: {
		readonly text?: string;
		readonly exception?: { readonly description?: string };
	};
};

// ¿Cuelga `url` de `baseUrl`? Mismo origen y la ruta de baseUrl como prefijo
export function isUnderBase(url: string, baseUrl: string): boolean {
	let u: URL;
	let b: URL;
	try {
		u = new URL(url);
		b = new URL(baseUrl);
	} catch {
		return false;
	}
	if (u.origin !== b.origin) return false;
	const prefix = b.pathname.endsWith("/") ? b.pathname : `${b.pathname}/`;
	return u.pathname === b.pathname || u.pathname.startsWith(prefix);
}

const describeException = (r: EvalReply): string =>
	r.exceptionDetails?.exception?.description ??
	r.exceptionDetails?.text ??
	"excepción";

// El login en el mundo aislado: rellena los dos campos (con eventos de entrada) y envía. Usuario y contraseña llegan
// como argumentos, así que no aparecen en este texto
const LOGIN_FUNCTION = `function (userSelector, passwordSelector, submitSelector, user, password) {
	const u = document.querySelector(userSelector);
	const p = document.querySelector(passwordSelector);
	if (!u || !p) return "no están los campos " + userSelector + " y " + passwordSelector;
	const set = (el, v) => {
		el.value = v;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
	};
	set(u, user);
	set(p, password);
	if (submitSelector) {
		const b = document.querySelector(submitSelector);
		if (!b) return "no está el botón " + submitSelector;
		b.click();
		return null;
	}
	const form = p.form || u.form;
	if (!form) return "los campos no están en un formulario";
	form.requestSubmit();
	return null;
}`;

export class CapturePage {
	readonly #cdp: CdpConnection;
	readonly #session: string;
	readonly #frameId: string;
	readonly #options: CapturePageOptions;
	readonly #blocked: string[] = [];
	#context: number | null = null;
	#hooksSource: string | null = null;
	// Las pseudoclases forzadas en este documento, por nodo (CSS.forcePseudoState las pide enteras cada vez)
	readonly #forced = new Map<number, string[]>();
	#domReady = false;

	private constructor(
		cdp: CdpConnection,
		session: string,
		frameId: string,
		options: CapturePageOptions,
	) {
		this.#cdp = cdp;
		this.#session = session;
		this.#frameId = frameId;
		this.#options = options;
	}

	static async open(
		chrome: CaptureChrome,
		options: CapturePageOptions,
	): Promise<Result<CapturePage, FigmaError>> {
		const { cdp } = chrome;
		try {
			const { targetId } = (await cdp.send(CDP.createTarget, {
				url: "about:blank",
				...(options.browserContextId !== undefined && {
					browserContextId: options.browserContextId,
				}),
			})) as { targetId: string };
			const { sessionId } = (await cdp.send(CDP.attachToTarget, {
				targetId,
				flatten: true,
			})) as { sessionId: string };
			await cdp.send(CDP.pageEnable, {}, sessionId);
			await cdp.send(CDP.runtimeEnable, {}, sessionId);
			await cdp.send(
				CDP.setDeviceMetricsOverride,
				{
					width: options.viewport.w,
					height: options.viewport.h,
					deviceScaleFactor: options.devicePixelRatio,
					mobile: false,
				},
				sessionId,
			);
			const tree = (await cdp.send(CDP.getFrameTree, {}, sessionId)) as {
				frameTree: { frame: { id: string } };
			};
			const page = new CapturePage(
				cdp,
				sessionId,
				tree.frameTree.frame.id,
				options,
			);
			await page.#guardNavigation();
			return ok(page);
		} catch (e) {
			return err(
				webPageError(
					WEB_PAGE_REASON.chrome,
					`no se pudo abrir la pestaña de captura: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	// Corta toda navegación de la pestaña (documento del marco principal) que salga de baseUrl
	async #guardNavigation(): Promise<void> {
		this.#cdp.on((e) => {
			if (e.sessionId !== this.#session || e.method !== CDP.requestPaused)
				return;
			const { requestId, frameId, resourceType, request } = e.params as {
				requestId: string;
				frameId?: string;
				resourceType?: string;
				request: { url: string };
			};
			const outside =
				resourceType === "Document" &&
				frameId === this.#frameId &&
				!isUnderBase(request.url, this.#options.baseUrl);
			if (outside) this.#blocked.push(request.url);
			void this.#cdp
				.send(
					outside ? CDP.fetchFail : CDP.fetchContinue,
					outside
						? { requestId, errorReason: "BlockedByClient" }
						: { requestId },
					this.#session,
				)
				.catch(() => undefined);
		});
		await this.#cdp.send(
			CDP.fetchEnable,
			{ patterns: [{ urlPattern: "*", resourceType: "Document" }] },
			this.#session,
		);
	}

	// La primera navegación cortada desde la última vez (y la olvida), o null
	#takeBlocked(): FigmaError | null {
		const url = this.#blocked.shift();
		this.#blocked.length = 0;
		return url === undefined
			? null
			: webPageError(WEB_PAGE_REASON.navigation, url);
	}

	#isLoad = (e: CdpEvent): boolean =>
		e.sessionId === this.#session && e.method === CDP.loadEventFired;

	// Cambia el tamaño de la pestaña (solo el viewport emulado: la escala y el devicePixelRatio no cambian)
	async setViewport(viewport: {
		readonly w: number;
		readonly h: number;
	}): Promise<Result<true, FigmaError>> {
		try {
			await this.#cdp.send(
				CDP.setDeviceMetricsOverride,
				{
					width: viewport.w,
					height: viewport.h,
					deviceScaleFactor: this.#options.devicePixelRatio,
					mobile: false,
				},
				this.#session,
			);
			return ok(true);
		} catch (e) {
			return err(
				webPageError(
					WEB_PAGE_REASON.chrome,
					`no se pudo cambiar el tamaño de la pestaña: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	// Navega a una ruta bajo baseUrl y espera a que cargue; el kit se reinstala (el mundo aislado es de cada documento)
	async navigate(path: string): Promise<Result<string, FigmaError>> {
		const url = new URL(path, this.#options.baseUrl).href;
		if (!isUnderBase(url, this.#options.baseUrl))
			return err(webPageError(WEB_PAGE_REASON.navigation, url));
		const loaded = this.#cdp.waitFor(this.#isLoad, this.#options.timeoutMs);
		let reply: { errorText?: string };
		try {
			reply = (await this.#cdp.send(CDP.navigate, { url }, this.#session)) as {
				errorText?: string;
			};
		} catch (e) {
			return err(webPageError(WEB_PAGE_REASON.load, `${url}: ${String(e)}`));
		}
		const blocked = this.#takeBlocked();
		if (blocked) return err(blocked);
		if (reply.errorText)
			return err(
				webPageError(WEB_PAGE_REASON.load, `${url}: ${reply.errorText}`),
			);
		if ((await loaded) === null)
			return err(
				webPageError(
					WEB_PAGE_REASON.load,
					`${url} no cargó en ${this.#options.timeoutMs} ms`,
				),
			);
		return this.#afterLoad();
	}

	async #afterLoad(): Promise<Result<string, FigmaError>> {
		const href = await this.evaluateInPage("location.href");
		if (!href.ok) return href;
		const current = String(href.value);
		if (!isUnderBase(current, this.#options.baseUrl))
			return err(webPageError(WEB_PAGE_REASON.navigation, current));
		// Una página de error (404, 500…) carga igual que una buena: sin esto se capturaría su contenido como si fuera la pantalla
		const status = await this.evaluateInPage(
			"performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0",
		);
		if (!status.ok) return status;
		if (Number(status.value) >= 400)
			return err(
				webPageError(
					WEB_PAGE_REASON.load,
					`${current} respondió HTTP ${String(status.value)}`,
				),
			);
		const installed = await this.#install();
		return installed.ok ? ok(current) : installed;
	}

	async #evaluate(
		expression: string,
		contextId: number | null,
	): Promise<Result<unknown, FigmaError>> {
		let r: EvalReply;
		try {
			r = (await this.#cdp.send(
				CDP.evaluate,
				{
					expression,
					awaitPromise: true,
					returnByValue: true,
					...(contextId === null ? {} : { contextId }),
				},
				this.#session,
			)) as EvalReply;
		} catch (e) {
			return err(webPageError(WEB_PAGE_REASON.load, String(e)));
		}
		if (r.exceptionDetails)
			return err(webPageError(WEB_PAGE_REASON.load, describeException(r)));
		return ok(r.result?.value);
	}

	// El kit (y los ganchos del proyecto, si los hay) en un mundo aislado nuevo del documento actual
	async #install(): Promise<Result<true, FigmaError>> {
		let world: { executionContextId: number };
		try {
			world = (await this.#cdp.send(
				CDP.createIsolatedWorld,
				{ frameId: this.#frameId, worldName: KIT_WORLD },
				this.#session,
			)) as { executionContextId: number };
		} catch (e) {
			return err(
				webPageError(WEB_PAGE_REASON.load, `mundo aislado: ${String(e)}`),
			);
		}
		this.#context = world.executionContextId;
		const kit = await this.#evaluate(this.#options.kitSource, this.#context);
		if (!kit.ok) return kit;
		if (this.#hooksSource !== null) {
			const used = await this.#evaluate(
				`${KIT_GLOBAL}.useHooks((${this.#hooksSource}))`,
				this.#context,
			);
			if (!used.ok) return used;
			if (typeof used.value === "string")
				return err(webPageError(WEB_PAGE_REASON.load, used.value));
		}
		return ok(true);
	}

	// Los ganchos del proyecto (texto del módulo): se evalúan en el mundo aislado de cada documento
	async useHooks(source: string): Promise<Result<true, FigmaError>> {
		this.#hooksSource = source;
		return this.#context === null ? ok(true) : this.#install();
	}

	// Una llamada al kit en su mundo; el resultado vuelve como JSON
	async kit(
		method: string,
		arg: unknown,
	): Promise<Result<unknown, FigmaError>> {
		if (this.#context === null)
			return err(
				webPageError(WEB_PAGE_REASON.load, "el kit no está instalado"),
			);
		const r = await this.#evaluate(
			`(async () => JSON.stringify((await ${KIT_GLOBAL}.${method}(${JSON.stringify(arg)})) ?? null))()`,
			this.#context,
		);
		return r.ok ? ok(JSON.parse(String(r.value)) as unknown) : r;
	}

	// Un clic en el mundo aislado. Si lleva a otra página bajo baseUrl, se espera a que cargue y se reinstala el kit
	async click(selector: string): Promise<Result<true, FigmaError>> {
		const loaded = this.#cdp.waitFor(this.#isLoad, TIMING.afterActionMs);
		const r = await this.kit("click", selector);
		if (!r.ok) return r;
		if (r.value !== true)
			return err(
				webPageError(
					WEB_PAGE_REASON.load,
					`no hay ningún elemento ${selector} donde hacer clic`,
				),
			);
		const navigated = await loaded;
		const blocked = this.#takeBlocked();
		if (blocked) return err(blocked);
		if (navigated) {
			const after = await this.#afterLoad();
			if (!after.ok) return after;
		}
		return ok(true);
	}

	// Fuerza las pseudoclases de una variante (hover, focus, focus-visible, active) en el primer elemento que casa con cada
	// `selector` del documento principal. Por CDP, fuera de los mundos de JavaScript. Varios estados sobre
	// un mismo selector se acumulan; se resuelven todos con un solo `DOM.getDocument` porque otra llamada renumera los nodos y
	// suelta lo forzado. Un selector sin elemento es WebPageError (load), como un clic sin elemento
	async force(
		forces: readonly { readonly selector: string; readonly state: string }[],
	): Promise<Result<true, FigmaError>> {
		const wanted = new Map<string, string[]>();
		for (const f of forces)
			wanted.set(f.selector, [...(wanted.get(f.selector) ?? []), f.state]);
		try {
			if (!this.#domReady) {
				await this.#cdp.send(CDP.domEnable, {}, this.#session);
				await this.#cdp.send(CDP.cssEnable, {}, this.#session);
				this.#domReady = true;
			}
			const doc = (await this.#cdp.send(
				CDP.getDocument,
				{ depth: 0 },
				this.#session,
			)) as { root: { nodeId: number } };
			for (const [selector, states] of wanted) {
				const found = (await this.#cdp.send(
					CDP.querySelector,
					{ nodeId: doc.root.nodeId, selector },
					this.#session,
				)) as { nodeId: number };
				if (!found.nodeId)
					return err(
						webPageError(
							WEB_PAGE_REASON.load,
							`no hay ningún elemento ${selector} donde forzar :${states[0] ?? ""}`,
						),
					);
				await this.#cdp.send(
					CDP.forcePseudoState,
					{ nodeId: found.nodeId, forcedPseudoClasses: states },
					this.#session,
				);
				this.#forced.set(found.nodeId, states);
			}
			return ok(true);
		} catch (e) {
			return err(
				webPageError(
					WEB_PAGE_REASON.load,
					`no se pudo forzar ${forces.map((f) => `:${f.state} en ${f.selector}`).join(", ")}: ${e instanceof Error ? e.message : String(e)}`,
				),
			);
		}
	}

	// Quita lo forzado; si la página ya no está (navegó), no hay nada que quitar
	async clearForced(): Promise<Result<true, FigmaError>> {
		for (const nodeId of this.#forced.keys()) {
			await this.#cdp
				.send(
					CDP.forcePseudoState,
					{ nodeId, forcedPseudoClasses: [] },
					this.#session,
				)
				.catch(() => undefined);
		}
		this.#forced.clear();
		return ok(true);
	}

	// Una expresión en el mundo de la página (pide allowPageWorld: lo comprueba el caso de uso antes)
	evaluateInPage(expression: string): Promise<Result<unknown, FigmaError>> {
		return this.#evaluate(expression, null);
	}

	// Sondea la condición en el mundo aislado; una que lanza cuenta como «todavía no»
	async until(
		condition: string,
		timeoutMs: number,
	): Promise<Result<true, FigmaError>> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			if (this.#context !== null) {
				const r = await this.#evaluate(`Boolean(${condition})`, this.#context);
				if (r.ok && r.value === true) return ok(true);
			}
			if (Date.now() >= deadline)
				return err(stateNotReached(condition, timeoutMs));
			await sleep(TIMING.pollMs);
		}
	}

	// Login por el formulario real: la contraseña es un argumento de callFunctionOn
	async login(
		form: LoginForm,
		user: string,
		password: string,
	): Promise<Result<true, FigmaError>> {
		const page = await this.navigate(form.path);
		if (!page.ok) return page;
		if (this.#context === null)
			return err(webPageError(WEB_PAGE_REASON.login, "sin mundo aislado"));
		const loaded = this.#cdp.waitFor(this.#isLoad, this.#options.timeoutMs);
		let reply: EvalReply;
		try {
			reply = (await this.#cdp.send(
				CDP.callFunctionOn,
				{
					functionDeclaration: LOGIN_FUNCTION,
					executionContextId: this.#context,
					arguments: [
						{ value: form.fields.user },
						{ value: form.fields.password },
						{ value: form.submit ?? null },
						{ value: user },
						{ value: password },
					],
					returnByValue: true,
				},
				this.#session,
			)) as EvalReply;
		} catch (e) {
			return err(webPageError(WEB_PAGE_REASON.login, String(e)));
		}
		if (reply.exceptionDetails)
			return err(webPageError(WEB_PAGE_REASON.login, describeException(reply)));
		if (typeof reply.result?.value === "string")
			return err(webPageError(WEB_PAGE_REASON.login, reply.result.value));
		if ((await loaded) === null)
			return err(
				webPageError(
					WEB_PAGE_REASON.login,
					`el formulario no respondió en ${this.#options.timeoutMs} ms`,
				),
			);
		const after = await this.#afterLoad();
		if (!after.ok) return after;
		const at = new URL(after.value);
		const loginAt = new URL(form.path, this.#options.baseUrl);
		if (at.pathname === loginAt.pathname)
			return err(
				webPageError(
					WEB_PAGE_REASON.login,
					`sigue en ${loginAt.pathname} tras enviar el formulario`,
				),
			);
		return ok(true);
	}
}
