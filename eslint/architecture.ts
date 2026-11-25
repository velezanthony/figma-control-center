// Fuente única de las fronteras que vigila ESLint: rutas, elementos y patrones. Los tests de lint importan de aquí.

export const PATH = {
	server: "server/src",
	domain: "server/src/domain",
	application: "server/src/application",
	adapters: "server/src/adapters",
	main: "server/src/main.ts",
	dashboard: "server/src/dashboard.ts",
	serverTest: "server/test",
	web: "web/src",
	atoms: "web/src/lib/ui/atoms",
	molecules: "web/src/lib/ui/molecules",
	organisms: "web/src/lib/ui/organisms",
	icons: "web/src/lib/ui/icons",
	pages: "web/src/pages",
	// Kits que corren en el navegador (capture-kit@1…): se empaquetan aparte y no tocan el servidor ni Node
	kits: "kits",
} as const;

export const ELEMENT = {
	domain: "domain",
	application: "application",
	adapter: "adapter",
	atom: "atom",
	molecule: "molecule",
	organism: "organism",
	icons: "icons",
	page: "page",
} as const;

export const CATEGORY = {
	server: "server",
	web: "web",
	testing: "testing",
	contract: "contract",
} as const;

export const ADAPTER = {
	http: "http",
	cdp: "cdp",
	mcp: "mcp",
	sqlite: "sqlite",
	// El Chrome de captura de la web (F1): lo cablea solo main.ts; el panel no lanza navegadores
	web: "web",
	// Contratos propios de las fronteras (zod), fuente única para los demás adaptadores
	contracts: "contracts",
} as const;

// Contratos que la web puede tocar, y solo como tipo: archivos autocontenidos del dominio
export const CONTRACT_FILES = [
	"activity",
	"history",
	"chat",
	"permission",
	"cancel-request",
	"agent",
	"settings",
	"attempt",
	"attempt-diff",
	"text-diff",
] as const;

// Librerías que solo viven en adapters/sqlite
export const SQLITE_LIBS = ["drizzle-orm*", "better-sqlite3"] as const;

// Carpetas de dobles de test y tests transversales: la producción no las importa
export const TESTING_GLOBS = [
	"**/testing/**",
	`${PATH.serverTest}/**`,
] as const;

const LAYER_DIRS = ["domain", "application", "adapters"] as const;
const OTHER_ALIASES = ["domain", "application", "adapters"] as const;

// Un relativo que cruza capas: entre capas se importa con alias `#…`
export const RELATIVE_ACROSS_LAYERS = `^\\.{1,2}/(?:.*/)?(?:${LAYER_DIRS.join("|")})/`;
// La web no usa alias de otros workspaces
export const WEB_TO_OTHERS = [`^#(?:${OTHER_ALIASES.join("|")})/`] as const;
// Un kit solo importa sus propios módulos (relativos): ni Node, ni alias, ni el servidor, ni paquetes. Única excepción:
// los tipos del API de plugins de Figma (`import type`, se borran al empaquetar)
export const KIT_TO_OTHERS = [
	"^(?!\\.{1,2}/|@figma/plugin-typings/plugin-api-standalone\\.d\\.ts$)",
	`(^|/)${PATH.server}/`,
] as const;
// Funciones de node:test cuya promesa recoge el runner
export const NODE_TEST_RUNNERS = ["describe", "it", "test", "suite"] as const;

// Un contrato no importa nada
export const ANY_IMPORT = ".";

export const ELEMENTS = [
	{ type: ELEMENT.domain, pattern: PATH.domain },
	{ type: ELEMENT.application, pattern: PATH.application },
	{ type: ELEMENT.adapter, pattern: `${PATH.adapters}/*`, capture: ["name"] },
	{ type: ELEMENT.atom, pattern: PATH.atoms },
	{ type: ELEMENT.molecule, pattern: PATH.molecules },
	{ type: ELEMENT.organism, pattern: PATH.organisms },
	{ type: ELEMENT.icons, pattern: PATH.icons },
	{ type: ELEMENT.page, pattern: PATH.pages },
].map((e) => ({ ...e, partialMatch: false }));

export const FILES = [
	{ pattern: `${PATH.server}/**`, category: CATEGORY.server },
	{ pattern: `${PATH.web}/**`, category: CATEGORY.web },
	{ pattern: [...TESTING_GLOBS], category: CATEGORY.testing },
	{
		pattern: `${PATH.domain}/{${CONTRACT_FILES.join(",")}}.ts`,
		category: CATEGORY.contract,
	},
];
