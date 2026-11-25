import type { StepIssue } from "./step.ts";

export const FIGMA_ERROR_TYPE = Object.freeze({
	chromeUnreachable: "ChromeUnreachable",
	figmaTabNotFound: "FigmaTabNotFound",
	figmaNotReady: "FigmaNotReady",
	scriptReadError: "ScriptReadError",
	scriptError: "ScriptError",
	nodeNotFound: "NodeNotFound",
	timeout: "Timeout",
} as const);

// Errores de la captura de la web (F1): no tocan Figma, así que no van en el catálogo E1 (que provoca cada error de
// FIGMA_ERROR_TYPE contra la pestaña de Figma); los cubren los escenarios E57-E61
export const WEB_ERROR_TYPE = Object.freeze({
	secretMissing: "SecretMissing",
	webPageError: "WebPageError",
	stateNotReached: "StateNotReached",
	projectConfigError: "ProjectConfigError",
	contractError: "ContractError",
} as const);

// Por qué falla la página al capturar: el login no entra, una navegación sale de baseUrl, el Chrome de captura no
// arranca (o su puerto ya lo usa otro), o la página no carga o el kit no se instala
export const WEB_PAGE_REASON = Object.freeze({
	login: "login",
	navigation: "navigation",
	chrome: "chrome",
	load: "load",
} as const);

export type WebPageReason =
	(typeof WEB_PAGE_REASON)[keyof typeof WEB_PAGE_REASON];

// Por qué no aparece el objeto `figma` en la pestaña: sin sesión, sin permiso de edición (Figma solo expone el
// API de plugins a quien puede editar) o porque el editor todavía está cargando
export const FIGMA_NOT_READY_REASON = Object.freeze({
	loading: "loading",
	notLoggedIn: "notLoggedIn",
	viewOnly: "viewOnly",
} as const);

export type FigmaNotReadyReason =
	(typeof FIGMA_NOT_READY_REASON)[keyof typeof FIGMA_NOT_READY_REASON];

type Common = {
	readonly message: string;
	readonly retryable: boolean;
	readonly nextStep: string;
};

export type FigmaError =
	| (Common & { readonly type: typeof FIGMA_ERROR_TYPE.chromeUnreachable })
	| (Common & { readonly type: typeof FIGMA_ERROR_TYPE.figmaTabNotFound })
	| (Common & {
			readonly type: typeof FIGMA_ERROR_TYPE.figmaNotReady;
			readonly reason: FigmaNotReadyReason;
	  })
	| (Common & {
			readonly type: typeof FIGMA_ERROR_TYPE.scriptReadError;
			readonly path: string;
	  })
	| (Common & {
			readonly type: typeof FIGMA_ERROR_TYPE.scriptError;
			readonly line: number | null;
	  })
	| (Common & {
			readonly type: typeof FIGMA_ERROR_TYPE.nodeNotFound;
			readonly nodeId: string;
	  })
	| (Common & {
			readonly type: typeof FIGMA_ERROR_TYPE.timeout;
			readonly timeoutMs: number;
	  })
	| (Common & {
			readonly type: typeof WEB_ERROR_TYPE.secretMissing;
			readonly secretRef: string;
	  })
	| (Common & {
			readonly type: typeof WEB_ERROR_TYPE.webPageError;
			readonly reason: WebPageReason;
	  })
	| (Common & {
			readonly type: typeof WEB_ERROR_TYPE.stateNotReached;
			readonly timeoutMs: number;
	  })
	| (Common & {
			readonly type: typeof WEB_ERROR_TYPE.projectConfigError;
			readonly path: string;
			readonly field: string;
	  })
	| (Common & {
			readonly type: typeof WEB_ERROR_TYPE.contractError;
			readonly path: string;
	  });

export type FigmaErrorType = FigmaError["type"];

// Un nextStep por causa. Regla de retryable: de la entrada → false; del entorno → true (y el nextStep
// dice si lo arregla el agente o necesita a una persona); incierto → false (mirar el job o el lienzo antes de repetir)
const NEXT_STEP = Object.freeze({
	startChrome: "Arranca Chrome con spikes/m0/chrome.sh y vuelve a intentarlo.",
	openFile: (fileUrl: string) =>
		`Abre ${fileUrl} en el Chrome de depuración (es la URL del proyecto, en la página «Proyectos» del panel) y vuelve a intentarlo.`,
	waitLoading: (fileUrl: string | undefined) =>
		`El editor aún está cargando: espera unos segundos y vuelve a intentarlo. Si no termina, comprueba la sesión de Figma con make login y que la URL del proyecto${fileUrl === undefined ? "" : ` (${fileUrl})`}, en la página «Proyectos», abre el archivo.`,
	login:
		"Necesita a una persona: ejecuta make login, inicia sesión en la ventana de Chrome que se abre, ciérrala y vuelve a arrancar con make chrome.",
	askEditAccess:
		"Necesita a una persona: tu cuenta solo puede ver este archivo; pide permiso de edición o duplícalo y da de alta el duplicado en la página «Proyectos».",
	fixPath: "Corrige la ruta: debe existir y estar dentro de FCC_SCRIPTS_ROOT.",
	fixManifest: (reason: string) =>
		`Corrige el manifiesto según el detalle (${reason}) y vuelve a lanzar el lote; repetirlo igual falla igual.`,
	fixAsset:
		"Corrige el asset indicado: debe existir, ser un fichero, estar dentro de FCC_SCRIPTS_ROOT y no superar el tope de tamaño.",
	reduceParams: "Reduce los params o pásalos como asset.",
	fixSyntax:
		"Corrige el error de sintaxis del script (mira la línea indicada) y vuelve a ejecutarlo.",
	fixException:
		"El script lanzó una excepción: corrígelo (mira la línea indicada y el mensaje) y vuelve a ejecutarlo.",
	checkNode:
		"Comprueba el id con figma_metadata (sin nodeId devuelve la página actual) y vuelve a pedirlo con un id que exista.",
	checkJob:
		"El script puede seguir ejecutándose en Figma: consulta el job con figma_get_job o revisa el lienzo antes de reintentar.",
	fixLogin:
		"Comprueba el usuario de la pantalla (web.users) y su contraseña en el fichero de secretos; repetirlo igual falla igual.",
	stayInside:
		"La captura solo navega bajo baseUrl: corrige la URL o la acción de la pantalla para que no salga.",
	checkCaptureChrome:
		"Revisa el Chrome de captura (FCC_WEB_CHROME_BIN y FCC_WEB_CHROME_PORT: que exista y que el puerto esté libre) y vuelve a capturar.",
	checkWeb:
		"Comprueba que la web está en marcha en baseUrl y que la pantalla carga en el navegador; después vuelve a capturar.",
	fixUntil:
		"La condición `until` no se cumplió en el plazo: corrígela, o la acción que lleva a ese estado, o sube FCC_WEB_PAGE_TIMEOUT_MS si la página es lenta.",
	fixProjectConfig: (field: string, file: string) =>
		`Corrige «${field}» en ${file} (contratos project@1 y screens@1) y vuelve a capturar; repetirlo igual falla igual.`,
	fixAreas: (file: string) =>
		`Corrige ${file} (contrato areas@1, con los frames de cada área y las pantallas de screens@1) y repite la llamada: no se tocó nada.`,
	fixMap: (file: string) =>
		`Corrige ${file} (contrato map@1: sus expresiones regulares tienen que compilar y no pasar de 200 caracteres) y repite la llamada: no se tocó nada.`,
	fixSheets: (file: string) =>
		`Corrige ${file} (contrato sheets@1, con las pantallas de screens@1 y sin nombres de propiedad repetidos) y repite la llamada: no se tocó nada.`,
	fixCompose: (file: string) =>
		`Corrige ${file} (contrato compose@1: solo hojas de sheets@1 y variables o estilos del archivo, sin números ni colores sueltos) y repite la llamada: no se tocó nada.`,
	fixStepResult:
		"El script ya corrió: comprueba el lienzo (figma_metadata) antes de repetirlo. Corrige el `return` para que cumpla step@1 (`createdNodeIds` y `mutatedNodeIds` son listas de ids de texto; `kit.track().done()` lo arma) o quita la cabecera `// @contract step@1`.",
	fixVariant:
		"Pide una de las variantes válidas (o quita `variant` para la que el set trae por defecto): no se leyó nada.",
	readRejected:
		"Mira los errores (código, id y ruta de cada nodo) en el fichero de errores: suele bastar un gancho `ignore` o ajustar la pantalla; repetir igual da lo mismo.",
	addSecret: (secretRef: string, file: string) =>
		`Necesita a una persona: añade «${secretRef}» con su contraseña al fichero de secretos de la máquina (${file}, FCC_WEB_SECRETS_FILE) y vuelve a capturar.`,
} as const);

export const chromeUnreachable = (endpoint: string): FigmaError => ({
	type: FIGMA_ERROR_TYPE.chromeUnreachable,
	message: `Chrome no responde en ${endpoint}.`,
	retryable: true,
	nextStep: NEXT_STEP.startChrome,
});

export const figmaTabNotFound = (
	fileUrl: string,
	detail?: string,
): FigmaError => ({
	type: FIGMA_ERROR_TYPE.figmaTabNotFound,
	message: `Ninguna pestaña de Chrome tiene el archivo ${fileUrl} (se compara por la clave del archivo).${detail === undefined ? "" : ` ${detail}`}`,
	retryable: true,
	nextStep: NEXT_STEP.openFile(fileUrl),
});

// Es del entorno: la misma llamada vale en cuanto se arregle. Sin sesión o sin permiso lo arregla una persona
const NOT_READY = Object.freeze({
	[FIGMA_NOT_READY_REASON.loading]: {
		cause: "",
		nextStep: NEXT_STEP.waitLoading,
	},
	[FIGMA_NOT_READY_REASON.notLoggedIn]: {
		cause: ": la pestaña no tiene sesión de Figma iniciada",
		nextStep: () => NEXT_STEP.login,
	},
	[FIGMA_NOT_READY_REASON.viewOnly]: {
		cause:
			": la cuenta solo tiene permiso de lectura y Figma no expone el API de plugins sin permiso de edición",
		nextStep: () => NEXT_STEP.askEditAccess,
	},
} as const satisfies Record<
	FigmaNotReadyReason,
	{ cause: string; nextStep: (fileUrl: string | undefined) => string }
>);

export const figmaNotReady = (
	waitedMs: number,
	reason: FigmaNotReadyReason = FIGMA_NOT_READY_REASON.loading,
	fileUrl?: string,
): FigmaError => ({
	type: FIGMA_ERROR_TYPE.figmaNotReady,
	reason,
	message: `El objeto figma no está disponible${waitedMs > 0 ? ` tras esperar ${waitedMs} ms` : ""}${NOT_READY[reason].cause}.`,
	retryable: true,
	nextStep: NOT_READY[reason].nextStep(fileUrl),
});

export const scriptReadError = (path: string, reason: string): FigmaError => ({
	type: FIGMA_ERROR_TYPE.scriptReadError,
	message: `No se pudo leer el script ${path}: ${reason}`,
	path,
	retryable: false,
	nextStep: NEXT_STEP.fixPath,
});

// Un asset que no se puede usar (no existe, está fuera de las raíces o el total supera el tope): mismo tipo
// que un script ilegible, para que CA-6 lo rechace antes de tocar Figma. No es reintentable sin corregir la entrada.
export const assetReadError = (path: string, reason: string): FigmaError => ({
	type: FIGMA_ERROR_TYPE.scriptReadError,
	message: `No se pudo usar el asset ${path}: ${reason}`,
	path,
	retryable: false,
	nextStep: NEXT_STEP.fixAsset,
});

// Un manifiesto de lote que no se puede leer o no cumple el esquema (JSON inválido, falta `steps`, un paso sin
// `file`, demasiados pasos): mismo tipo que un script ilegible para que CA-6 lo rechace antes de tocar Figma.
export const manifestError = (path: string, reason: string): FigmaError => ({
	type: FIGMA_ERROR_TYPE.scriptReadError,
	message: `No se pudo leer el manifiesto ${path}: ${reason}`,
	path,
	retryable: false,
	nextStep: NEXT_STEP.fixManifest(reason),
});

// Los `params` de una llamada o un paso superan FCC_MAX_PARAMS_BYTES: se rechaza sin tocar Figma.
export const paramsTooLargeError = (
	bytes: number,
	maxBytes: number,
): FigmaError => ({
	type: FIGMA_ERROR_TYPE.scriptReadError,
	message: `Los params superan el tope: ${bytes} > ${maxBytes} bytes.`,
	path: "(params)",
	retryable: false,
	nextStep: NEXT_STEP.reduceParams,
});

export const scriptError = (
	message: string,
	line: number | null,
	isSyntaxError: boolean,
): FigmaError => ({
	type: FIGMA_ERROR_TYPE.scriptError,
	message,
	line,
	retryable: false,
	nextStep: isSyntaxError ? NEXT_STEP.fixSyntax : NEXT_STEP.fixException,
});

// `kit.fail(código, mensaje, siguiente)` del kit de Figma: el código va delante del mensaje y el siguiente paso es el
// que dio el script, no el genérico. No reintentable: repetirlo igual falla igual
export const kitScriptError = (
	code: string,
	message: string,
	nextStep: string,
	line: number | null,
): FigmaError => ({
	type: FIGMA_ERROR_TYPE.scriptError,
	message: `${code}: ${message}${line === null ? "" : ` (línea ${line})`}`,
	line,
	retryable: false,
	nextStep,
});

// Fallo inesperado al ejecutar un script (p. ej. el transporte CDP rechaza, o un callback lanza): no reintentable.
export const unexpectedScriptError = (e: unknown): FigmaError =>
	scriptError(
		`Fallo inesperado al ejecutar el script: ${e instanceof Error ? e.message : String(e)}`,
		null,
		false,
	);

// Entrada: el id no está en el archivo. Repetir el mismo id da lo mismo
export const nodeNotFound = (nodeId: string): FigmaError => ({
	type: FIGMA_ERROR_TYPE.nodeNotFound,
	message: `El nodo ${nodeId} no existe en el archivo.`,
	nodeId,
	retryable: false,
	nextStep: NEXT_STEP.checkNode,
});

export const callTimeout = (timeoutMs: number): FigmaError => ({
	type: FIGMA_ERROR_TYPE.timeout,
	message: `La llamada a Chrome superó ${timeoutMs} ms.`,
	timeoutMs,
	retryable: false,
	nextStep: NEXT_STEP.checkJob,
});

// Captura de la web: el secretRef de un usuario no tiene valor en el fichero de secretos de la máquina (o el fichero no
// se puede leer). Se dice ANTES de lanzar Chrome. Nunca lleva un valor, solo el nombre
export const secretMissing = (
	secretRef: string,
	file: string,
	detail = "no está en el fichero",
): FigmaError => ({
	type: WEB_ERROR_TYPE.secretMissing,
	message: `Falta el secreto «${secretRef}»: ${detail}.`,
	secretRef,
	retryable: false,
	nextStep: NEXT_STEP.addSecret(secretRef, file),
});

const WEB_PAGE = Object.freeze({
	[WEB_PAGE_REASON.login]: {
		cause: "el login no entra",
		retryable: false,
		nextStep: NEXT_STEP.fixLogin,
	},
	[WEB_PAGE_REASON.navigation]: {
		cause: "una navegación sale de baseUrl y no se sigue",
		retryable: false,
		nextStep: NEXT_STEP.stayInside,
	},
	[WEB_PAGE_REASON.chrome]: {
		cause: "el Chrome de captura no está disponible",
		retryable: true,
		nextStep: NEXT_STEP.checkCaptureChrome,
	},
	[WEB_PAGE_REASON.load]: {
		cause: "la página no carga",
		retryable: true,
		nextStep: NEXT_STEP.checkWeb,
	},
} as const satisfies Record<
	WebPageReason,
	{ cause: string; retryable: boolean; nextStep: string }
>);

export const webPageError = (
	reason: WebPageReason,
	detail: string,
): FigmaError => ({
	type: WEB_ERROR_TYPE.webPageError,
	reason,
	message: `Captura de la web: ${WEB_PAGE[reason].cause} (${detail}).`,
	retryable: WEB_PAGE[reason].retryable,
	nextStep: WEB_PAGE[reason].nextStep,
});

// La condición `until` de una pantalla o variante no llegó a ser verdadera en el plazo
export const stateNotReached = (
	condition: string,
	timeoutMs: number,
): FigmaError => ({
	type: WEB_ERROR_TYPE.stateNotReached,
	message: `El estado no llegó: \`${condition}\` sigue sin cumplirse tras ${timeoutMs} ms.`,
	timeoutMs,
	retryable: false,
	nextStep: NEXT_STEP.fixUntil,
});

// La configuración de captura del proyecto (figma-control-center.json, su screens@1 o sus ganchos) falta o no cumple
export const projectConfigError = (
	file: string,
	field: string,
	detail: string,
): FigmaError => ({
	type: WEB_ERROR_TYPE.projectConfigError,
	message: `La configuración de captura ${file} no vale en «${field}»: ${detail}.`,
	path: file,
	field,
	retryable: false,
	nextStep: NEXT_STEP.fixProjectConfig(field, file),
});

// Alguna captura no cumple capture@1: no se guarda como válida (va a rejected/ con sus errores)
export const contractError = (
	rejected: number,
	errorsFile: string,
): FigmaError => ({
	type: WEB_ERROR_TYPE.contractError,
	message: `${rejected} ${rejected === 1 ? "captura no cumple" : "capturas no cumplen"} capture@1 y ${rejected === 1 ? "va" : "van"} a rejected/; los errores, en ${errorsFile}.`,
	path: errorsFile,
	retryable: false,
	nextStep: NEXT_STEP.readRejected,
});

// El fichero de áreas no cumple areas@1 o no cuadra con screens@1. `path` es el puntero JSON del
// primer fallo. No se tocó nada (ni job ni Figma): repetir tras corregir el fichero vale
const MAX_AREAS_ISSUES_SHOWN = 3;
export const areasContractError = (
	file: string,
	issues: readonly { readonly pointer: string; readonly message: string }[],
): FigmaError => {
	const shown = issues
		.slice(0, MAX_AREAS_ISSUES_SHOWN)
		.map((i) => `${i.pointer === "" ? "/" : i.pointer}: ${i.message}`);
	const more = issues.length - shown.length;
	return {
		type: WEB_ERROR_TYPE.contractError,
		message: `El fichero de áreas ${file} no cumple areas@1: ${shown.join("; ")}${more > 0 ? ` (y ${more} más)` : ""}.`,
		path:
			issues[0]?.pointer === "" || issues[0] === undefined
				? "/"
				: issues[0].pointer,
		retryable: true,
		nextStep: NEXT_STEP.fixAreas(file),
	};
};

// map@1 no cumple su contrato (esquema o una expresión regular). Como areasContractError: no se tocó nada
export const mapContractError = (
	file: string,
	issues: readonly { readonly pointer: string; readonly message: string }[],
): FigmaError => {
	const shown = issues
		.slice(0, MAX_AREAS_ISSUES_SHOWN)
		.map((i) => `${i.pointer === "" ? "/" : i.pointer}: ${i.message}`);
	const more = issues.length - shown.length;
	return {
		type: WEB_ERROR_TYPE.contractError,
		message: `El mapa ${file} no cumple map@1: ${shown.join("; ")}${more > 0 ? ` (y ${more} más)` : ""}.`,
		path:
			issues[0]?.pointer === "" || issues[0] === undefined
				? "/"
				: issues[0].pointer,
		retryable: true,
		nextStep: NEXT_STEP.fixMap(file),
	};
};

// sheets@1 no cumple su contrato (esquema, claves repetidas o el cruce con screens@1). Como mapContractError: no se tocó nada
export const sheetsContractError = (
	file: string,
	issues: readonly { readonly pointer: string; readonly message: string }[],
): FigmaError => {
	const shown = issues
		.slice(0, MAX_AREAS_ISSUES_SHOWN)
		.map((i) => `${i.pointer === "" ? "/" : i.pointer}: ${i.message}`);
	const more = issues.length - shown.length;
	return {
		type: WEB_ERROR_TYPE.contractError,
		message: `El fichero de hojas ${file} no cumple sheets@1: ${shown.join("; ")}${more > 0 ? ` (y ${more} más)` : ""}.`,
		path:
			issues[0]?.pointer === "" || issues[0] === undefined
				? "/"
				: issues[0].pointer,
		retryable: true,
		nextStep: NEXT_STEP.fixSheets(file),
	};
};

// Un compose@1 no cumple su contrato (esquema, o lo que el esquema no ve: la hoja, la variante, el token). Como
// sheetsContractError: no se tocó nada, y `path` es el puntero JSON del primer fallo
export const composeContractError = (
	file: string,
	issues: readonly { readonly pointer: string; readonly message: string }[],
): FigmaError => {
	const shown = issues
		.slice(0, MAX_AREAS_ISSUES_SHOWN)
		.map((i) => `${i.pointer === "" ? "/" : i.pointer}: ${i.message}`);
	const more = issues.length - shown.length;
	return {
		type: WEB_ERROR_TYPE.contractError,
		message: `El compose ${file} no cumple compose@1: ${shown.join("; ")}${more > 0 ? ` (y ${more} más)` : ""}.`,
		path:
			issues[0]?.pointer === "" || issues[0] === undefined
				? "/"
				: issues[0].pointer,
		retryable: true,
		nextStep: NEXT_STEP.fixCompose(file),
	};
};

// Un paso que declara `// @contract step@1` devolvió algo que no cumple el contrato. `path` es el puntero JSON del primer
// fallo («/» si es la raíz). El script ya corrió: no es reintentable (repetirlo repite sus efectos)
const MAX_STEP_ISSUES_SHOWN = 3;
export const stepContractError = (issues: readonly StepIssue[]): FigmaError => {
	const shown = issues
		.slice(0, MAX_STEP_ISSUES_SHOWN)
		.map((i) => `${i.pointer === "" ? "/" : i.pointer}: ${i.message}`);
	const more = issues.length - shown.length;
	return {
		type: WEB_ERROR_TYPE.contractError,
		message: `El resultado del paso no cumple step@1: ${shown.join("; ")}${more > 0 ? ` (y ${more} más)` : ""}.`,
		path:
			issues[0]?.pointer === "" || issues[0] === undefined
				? "/"
				: issues[0].pointer,
		retryable: false,
		nextStep: NEXT_STEP.fixStepResult,
	};
};

// figma_design_context con un set como raíz y una `variant` que no existe en él. No se
// leyó nada: repetirla igual falla igual. El mensaje trae las propiedades de variante y sus opciones
export const designVariantError = (
	requested: Readonly<Record<string, string>>,
	variants: Readonly<Record<string, readonly string[]>>,
): FigmaError => {
	const asked = Object.entries(requested)
		.map(([prop, value]) => `${prop}=${value}`)
		.join(", ");
	const valid = Object.entries(variants)
		.map(([prop, options]) => `${prop}: ${options.join(", ")}`)
		.join("; ");
	return {
		type: WEB_ERROR_TYPE.contractError,
		message: `La variante pedida (${asked}) no existe en el set. Propiedades y opciones válidas: ${valid}.`,
		path: "/variant",
		retryable: false,
		nextStep: NEXT_STEP.fixVariant,
	};
};
