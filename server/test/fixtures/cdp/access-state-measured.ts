// Señales que la sonda `access-state` midió en una pestaña del archivo de pruebas (output/contract-samples, fuera de git).
// Solo booleanos y el primer trozo de la ruta: ni nombres de claves ni valores del usuario.
// «Cargando» (dos estados) medido con `make e2e-record STATE=cargando`, 2026-11-11, archivo de pruebas. FALTA por medir
// «solo lectura» (make e2e-record STATE=solo-lectura; necesita un archivo de solo lectura que el dueño no tiene).
export const ACCESS_STATE_MEASURED = Object.freeze({
	ready: {
		figmaType: "object",
		firstPathSegment: "design",
		hasInitialOptions: true,
		hasUserData: true,
		canEdit: true,
	},
	// Sin sesión la ruta NO cambia a /login: sigue en /design/…
	noSession: {
		figmaType: "undefined",
		firstPathSegment: "design",
		hasInitialOptions: true,
		hasUserData: false,
		canEdit: false,
	},
	// Cargando 1: pestaña recién creada, aún sin navegar (about:blank): sin ruta ni INITIAL_OPTIONS
	loadingBeforeNavigation: {
		figmaType: "undefined",
		firstPathSegment: null,
		hasInitialOptions: false,
		hasUserData: false,
		canEdit: null,
	},
	// Cargando 2: página de Figma cargada (a los 2 y a los 4 s, idénticos) pero sin la API de plugins todavía
	loadingWithoutApi: {
		figmaType: "undefined",
		firstPathSegment: "design",
		hasInitialOptions: true,
		hasUserData: true,
		canEdit: true,
	},
} as const);

export type AccessSignals = (typeof ACCESS_STATE_MEASURED)[keyof typeof ACCESS_STATE_MEASURED];
