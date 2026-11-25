import boundaries from "eslint-plugin-boundaries";
import svelteParser from "svelte-eslint-parser";
import tseslint from "typescript-eslint";
import {
	ADAPTER,
	ANY_IMPORT,
	CATEGORY,
	CONTRACT_FILES,
	ELEMENT,
	ELEMENTS,
	FILES,
	KIT_TO_OTHERS,
	NODE_TEST_RUNNERS,
	PATH,
	RELATIVE_ACROSS_LAYERS,
	SQLITE_LIBS,
	WEB_TO_OTHERS,
} from "./eslint/architecture.ts";

// Biome formatea y lint general; ESLint solo vigila fronteras (boundaries) y promesas con tipos.

const TYPED_TS = ["server/{src,test}/**/*.ts", "web/src/**/*.ts"];
const WEB_TESTS = [
	"web/test/*.ts",
	"web/test/components/*.ts",
	"web/src/**/*.test.ts",
];
const SVELTE = [`${PATH.web}/**/*.svelte`];
const TESTS = ["**/*.test.ts"];
const CONTRACTS = CONTRACT_FILES.map((f) => `${PATH.domain}/${f}.ts`);

// Las reglas con tipos solo corren donde hay tsconfig: los tests de la web (tsconfig.node.json) entran por el proyecto por defecto
const typed = { projectService: true, tsconfigRootDir: import.meta.dirname };

// describe/it/test de node:test devuelven una promesa que el runner ya recoge: no son promesas flotantes
const promises = {
	"@typescript-eslint/no-floating-promises": [
		"error",
		{
			allowForKnownSafeCalls: [
				{ from: "package", package: "node:test", name: [...NODE_TEST_RUNNERS] },
			],
		},
	],
	"@typescript-eslint/no-misused-promises": "error",
} as const;

const anyServer = { file: { categories: CATEGORY.server } };
const anyWeb = { file: { categories: CATEGORY.web } };
const testingDoubles = { file: { categories: CATEGORY.testing } };
const outsideWorld = { module: { origin: ["core", "external"] } };
const sqliteLibs = { module: { source: [...SQLITE_LIBS] } };
const adapter = (name: string | string[]) => ({
	element: { type: ELEMENT.adapter, captured: { name } },
});

const restrict = (...regex: readonly string[]) =>
	["error", { patterns: regex.map((r) => ({ regex: r })) }] as const;

// Gana la ÚLTIMA política que encaja: primero lo general, después las excepciones
const policies = [
	// Servidor: domain no importa nada interno ni de fuera
	{
		from: { element: { type: ELEMENT.domain } },
		disallow: { to: [anyServer, outsideWorld] },
	},
	// application solo importa domain (y Node)
	{
		from: { element: { type: ELEMENT.application } },
		disallow: { to: [anyServer, { module: { origin: "external" } }] },
	},
	{
		from: { element: { type: ELEMENT.application } },
		allow: { to: { element: { type: ELEMENT.domain } } },
	},
	// adapters importan application y domain, nunca entre ellos
	{ from: { element: { type: ELEMENT.adapter } }, disallow: { to: anyServer } },
	{
		from: { element: { type: ELEMENT.adapter } },
		allow: {
			to: { element: { types: [ELEMENT.application, ELEMENT.domain] } },
		},
	},
	// salvo los contratos comunes (adapters/contracts), que sí comparten
	{
		from: { element: { type: ELEMENT.adapter } },
		allow: { to: adapter(ADAPTER.contracts) },
	},
	// Drizzle y el driver solo viven en adapters/sqlite
	{ from: anyServer, disallow: { to: sqliteLibs } },
	{ from: adapter(ADAPTER.sqlite), allow: { to: sqliteLibs } },
	// El proceso MCP no carga el panel; el panel no habla con Figma ni con MCP
	{
		from: { file: { path: PATH.main } },
		disallow: { to: adapter(ADAPTER.http) },
	},
	{
		from: { file: { path: PATH.dashboard } },
		disallow: { to: adapter([ADAPTER.cdp, ADAPTER.mcp, ADAPTER.web]) },
	},
	// La producción no importa dobles ni tests; los dobles entre sí, sí
	{ from: anyServer, disallow: { to: testingDoubles } },
	{ from: testingDoubles, allow: { to: testingDoubles } },
	// La web (navegador): ni Node ni el servidor, salvo los contratos y solo como tipo
	{
		from: anyWeb,
		disallow: { to: [anyServer, { module: { origin: "core" } }] },
	},
	{
		from: anyWeb,
		allow: {
			to: { file: { categories: CATEGORY.contract } },
			dependency: { kind: "type" },
		},
	},
	// Páginas: componen organismos y, para su maquetación, moléculas, átomos e iconos. Nadie de lib/ui las importa
	{
		from: {
			element: {
				types: [
					ELEMENT.atom,
					ELEMENT.molecule,
					ELEMENT.organism,
					ELEMENT.icons,
				],
			},
		},
		disallow: { to: { element: { type: ELEMENT.page } } },
	},
	// Niveles atómicos: nada hacia arriba; los iconos (fundamento) los usa cualquiera y no importan componentes
	{
		from: { element: { type: ELEMENT.atom } },
		disallow: {
			to: { element: { types: [ELEMENT.molecule, ELEMENT.organism] } },
		},
	},
	{
		from: { element: { type: ELEMENT.molecule } },
		disallow: { to: { element: { type: ELEMENT.organism } } },
	},
	{
		from: { element: { type: ELEMENT.icons } },
		disallow: {
			to: {
				element: { types: [ELEMENT.atom, ELEMENT.molecule, ELEMENT.organism] },
			},
		},
	},
] as const;

export default [
	{
		ignores: [
			"**/dist/**",
			"server/test/fixtures/**",
			"scripts/**",
			"spikes/**",
			"_local/**",
			"docs-site/**",
		],
	},
	{
		files: TYPED_TS,
		ignores: WEB_TESTS,
		languageOptions: { parser: tseslint.parser, parserOptions: typed },
		plugins: { "@typescript-eslint": tseslint.plugin },
		rules: promises,
	},
	{
		files: WEB_TESTS,
		languageOptions: { parser: tseslint.parser },
	},
	{
		files: SVELTE,
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tseslint.parser,
				extraFileExtensions: [".svelte"],
				...typed,
			},
		},
		plugins: { "@typescript-eslint": tseslint.plugin },
		rules: promises,
	},
	{
		files: [`${PATH.server}/**/*.ts`, `${PATH.web}/**/*.{ts,svelte}`],
		ignores: TESTS,
		plugins: { boundaries },
		settings: {
			"import/resolver": {
				typescript: {
					noWarnOnMultipleProjects: true,
					project: ["server/tsconfig.json", "web/tsconfig.json"],
				},
			},
			"boundaries/elements": ELEMENTS,
			"boundaries/files": FILES,
		},
		rules: {
			"boundaries/dependencies": [
				"error",
				{ default: "allow", checkAllOrigins: true, policies },
			],
		},
	},
	{
		files: [`${PATH.server}/**/*.ts`],
		ignores: TESTS,
		rules: {
			"no-restricted-imports": restrict(RELATIVE_ACROSS_LAYERS),
		},
	},
	{
		files: [`${PATH.web}/**/*.{ts,svelte}`],
		ignores: TESTS,
		rules: { "no-restricted-imports": restrict(...WEB_TO_OTHERS) },
	},
	{
		files: CONTRACTS,
		rules: { "no-restricted-imports": restrict(ANY_IMPORT) },
	},
	{
		files: [`${PATH.kits}/**/*.ts`],
		languageOptions: { parser: tseslint.parser },
		rules: { "no-restricted-imports": restrict(...KIT_TO_OTHERS) },
	},
];
