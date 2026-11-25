// Constantes del Chrome DevTools Protocol que usa el adaptador CDP (fijas: no son configuración).

export const CDP_HTTP_PATH = Object.freeze({
	targets: "/json/list",
	// PUT: abre una pestaña con la URL tras el «?». /json/close/<id> cierra la pestaña de ese id
	newTarget: "/json/new",
	closeTarget: "/json/close/",
	version: "/json/version",
} as const);

export const CDP_TARGET_TYPE = Object.freeze({ page: "page" } as const);

export const CDP_METHOD = Object.freeze({
	evaluate: "Runtime.evaluate",
} as const);

// Opciones de Runtime.evaluate: esperar a la promesa del script y recibir el valor ya serializado
export const CDP_EVALUATE_OPTIONS = Object.freeze({
	awaitPromise: true,
	returnByValue: true,
} as const);

// Lo que lanza el fragmento `locate` de los scripts internos cuando el id no existe; el adaptador lo convierte en
// NodeNotFound (sin la línea del envoltorio, que no le dice nada al agente)
export const NODE_NOT_FOUND_MARKER = "__figma_node_not_found__:";

// Diagnóstico de acceso a la pestaña, el mismo para figma_status y para la espera a `figma` (cdp-client). Una sola
// expresión de solo lectura, sin depender del idioma:
//  - `window.INITIAL_OPTIONS` (datos que Figma inyecta al cargar la página): `user_data` existe con sesión y
//    `editing_file.can_edit` es false con permiso de solo lectura.
//  - VERIFICADO en vivo, con la sonda `access-state` (fixtures/cdp/access-state-measured.ts): «listo» (figma es un
//    objeto, hay user_data, can_edit true) y «sin sesión» (figma undefined, sin user_data, can_edit false; la ruta
//    NO se redirige a /login, sigue en /design/…). «Solo lectura» se vio en vivo en 2026-11-07 (typeof figma
//    "undefined", user_data con id, can_edit false) pero no está medido con la sonda.
//  - VERIFICADO en vivo (2026-11-11, `make e2e-record STATE=cargando`): «cargando» son dos estados medidos. Pestaña recién
//    creada sin navegar: sin figma, sin ruta ni INITIAL_OPTIONS. Página de Figma cargada sin la API de plugins todavía
//    (igual a los 2 y a los 4 s): sin figma, con user_data y can_edit true. Ambos caen en «cargando».
// INITIAL_OPTIONS es el estado al cargar la página: tras conceder permiso hay que recargar la pestaña.
export const FIGMA_ACCESS = Object.freeze({
	ready: "ready",
	loading: "loading",
	notLoggedIn: "notLoggedIn",
	viewOnly: "viewOnly",
} as const);

export const FIGMA_ACCESS_EXPRESSION = `(() => {
	if (typeof figma === "object") return "${FIGMA_ACCESS.ready}";
	if (globalThis.location?.pathname?.startsWith("/login")) return "${FIGMA_ACCESS.notLoggedIn}";
	const options = globalThis.INITIAL_OPTIONS;
	if (options === null || typeof options !== "object") return "${FIGMA_ACCESS.loading}";
	if (options.user_data == null) return "${FIGMA_ACCESS.notLoggedIn}";
	if (options.editing_file?.can_edit === false) return "${FIGMA_ACCESS.viewOnly}";
	return "${FIGMA_ACCESS.loading}";
})()`;

export const READY_POLL_INTERVAL_MS = 1000;

export const JS_SYNTAX_ERROR_CLASS = "SyntaxError";

// El kit de Figma (kits/figma → kits/dist/figma-kit.js): el servidor lo instala en la pestaña bajo este global y deja
// al lado el hash del empaquetado que instaló. Un test comprueba que coinciden con los del kit (que no puede importarse)
export const FIGMA_KIT_GLOBAL = "__fccFigmaKit";
export const FIGMA_KIT_SHA_GLOBAL = "__fccFigmaKitSha";

// Lo que lleva delante el mensaje de `kit.fail(código, mensaje, siguiente)`: el adaptador lo convierte en ScriptError
export const KIT_FAIL_MARKER = "__fcc_kit_fail__:";
