// Valores fijos del adaptador de la captura de la web: el Chrome de captura, su perfil
// temporal, el mundo aislado donde corre el kit y los métodos de CDP que se usan.
import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
// El kit empaquetado (kits/dist/capture-kit.js): el servidor solo lee el fichero y lo manda como texto
export const KIT_BUNDLE = resolve(REPO_ROOT, "kits/dist/capture-kit.js");
// El nombre con el que el kit se instala en su mundo (kits/capture/index.ts)
export const KIT_GLOBAL = "__figmaCaptureKit";
export const KIT_WORLD = "figma-control-center-capture";
// El lock de captura de la máquina (FCC_LOCK_DIR): una captura a la vez, porque el puerto del Chrome de captura es uno
export const CAPTURE_LOCK_NAME = "web-capture";

// Cada perfil temporal es una carpeta nueva con este prefijo bajo FCC_WEB_CHROME_PROFILE_DIR; al empezar una captura
// se borran los que quedaron de una que murió a medias
export const PROFILE_PREFIX = "figma-web-capture-";
// El prefijo de antes: sus perfiles huérfanos también se barren
export const LEGACY_PROFILE_PREFIX = "figma-captura-web-";

export const LOOPBACK = "127.0.0.1";
export const VERSION_PATH = "/json/version";

export const CHROME_FLAGS = [
	"--headless=new",
	"--no-first-run",
	"--no-default-browser-check",
	"--disable-background-networking",
	"--disable-sync",
] as const;

// Un ratón en un Chrome sin cabeza: PointerType fine = 4, HoverType hover = 2 (enums de Blink)
export const POINTER_DEVICE_FLAG =
	"--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2";

export const TIMING = Object.freeze({
	// Cada cuánto se mira si el Chrome recién lanzado ya contesta
	startPollMs: 100,
	// Cuánto se espera a que acabe con SIGTERM antes de SIGKILL
	killGraceMs: 3000,
	// Respiro tras una acción (fin de transición)
	afterActionMs: 300,
	// Sondeo de `until`
	pollMs: 50,
} as const);

export const CDP = Object.freeze({
	createTarget: "Target.createTarget",
	createBrowserContext: "Target.createBrowserContext",
	disposeBrowserContext: "Target.disposeBrowserContext",
	attachToTarget: "Target.attachToTarget",
	pageEnable: "Page.enable",
	runtimeEnable: "Runtime.enable",
	navigate: "Page.navigate",
	getFrameTree: "Page.getFrameTree",
	createIsolatedWorld: "Page.createIsolatedWorld",
	evaluate: "Runtime.evaluate",
	callFunctionOn: "Runtime.callFunctionOn",
	setDeviceMetricsOverride: "Emulation.setDeviceMetricsOverride",
	domEnable: "DOM.enable",
	cssEnable: "CSS.enable",
	getDocument: "DOM.getDocument",
	querySelector: "DOM.querySelector",
	forcePseudoState: "CSS.forcePseudoState",
	fetchEnable: "Fetch.enable",
	fetchContinue: "Fetch.continueRequest",
	fetchFail: "Fetch.failRequest",
	// Eventos
	loadEventFired: "Page.loadEventFired",
	requestPaused: "Fetch.requestPaused",
} as const);
