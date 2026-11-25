import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { ESLint, type Linter } from "eslint";
import { ADAPTER, PATH } from "../../eslint/architecture.ts";

// Cada regla de ESLint tiene un caso que DEBE saltar y, donde importa, uno vecino que NO debe saltar.
// Los fixtures viven en fixtures/lint/: el código se lintea «como si» estuviera en la ruta `as`.

const ROOT = join(import.meta.dirname, "../..");
const FIXTURES = join(import.meta.dirname, "fixtures/lint");

const RULE = Object.freeze({
	boundaries: "boundaries/dependencies",
	restricted: "no-restricted-imports",
	floating: "@typescript-eslint/no-floating-promises",
	misused: "@typescript-eslint/no-misused-promises",
} as const);

// Sin reglas con tipos: el archivo virtual no existe en ningún tsconfig
const UNTYPED: Linter.Config = {
	files: ["**/*.ts", "**/*.svelte"],
	languageOptions: { parserOptions: { projectService: false } },
	rules: { [RULE.floating]: "off", [RULE.misused]: "off" },
};

type Case = {
	readonly name: string;
	readonly fixture: string;
	readonly as: string;
	readonly fires: readonly string[];
};

const at = (dir: string, file: string) => `${dir}/${file}`;
const domain = (f = "__fixture__.ts") => at(PATH.domain, f);
const application = (f = "__fixture__.ts") => at(PATH.application, f);
const adapter = (name: string, f = "__fixture__.ts") =>
	at(`${PATH.adapters}/${name}`, f);
const web = (f = "lib/__fixture__.ts") => at(PATH.web, f);

const VIOLATIONS: readonly Case[] = [
	{
		name: "domain no importa application",
		fixture: "domain-imports-application.ts",
		as: domain(),
		fires: [RULE.boundaries],
	},
	{
		name: "domain no importa adapters ni por ruta relativa",
		fixture: "domain-imports-adapters-relative.ts",
		as: domain(),
		fires: [RULE.boundaries, RULE.restricted],
	},
	{
		name: "domain no importa Node",
		fixture: "domain-imports-node.ts",
		as: domain(),
		fires: [RULE.boundaries],
	},
	{
		name: "domain no importa terceros",
		fixture: "domain-imports-third-party.ts",
		as: domain(),
		fires: [RULE.boundaries],
	},
	{
		name: "application no importa adapters",
		fixture: "application-imports-adapters.ts",
		as: application(),
		fires: [RULE.boundaries],
	},
	{
		name: "application no importa terceros",
		fixture: "application-imports-third-party.ts",
		as: application(),
		fires: [RULE.boundaries],
	},
	{
		name: "un adapter no importa otro adapter",
		fixture: "adapter-imports-other-adapter.ts",
		as: adapter(ADAPTER.mcp),
		fires: [RULE.boundaries],
	},
	{
		name: "main.ts no importa adapters/http",
		fixture: "main-imports-http.ts",
		as: PATH.main,
		fires: [RULE.boundaries],
	},
	{
		name: "dashboard.ts no importa adapters/cdp",
		fixture: "dashboard-imports-cdp.ts",
		as: PATH.dashboard,
		fires: [RULE.boundaries],
	},
	{
		name: "dashboard.ts no importa adapters/mcp",
		fixture: "dashboard-imports-mcp.ts",
		as: PATH.dashboard,
		fires: [RULE.boundaries],
	},
	{
		name: "adapters/sqlite solo lo cablean las raíces (no otro adapter)",
		fixture: "sqlite-from-adapter.ts",
		as: adapter(ADAPTER.mcp),
		fires: [RULE.boundaries],
	},
	{
		name: "adapters/sqlite solo lo cablean las raíces (no application)",
		fixture: "sqlite-from-application.ts",
		as: application(),
		fires: [RULE.boundaries],
	},
	{
		name: "drizzle-orm solo vive en adapters/sqlite",
		fixture: "drizzle-outside-sqlite.ts",
		as: adapter(ADAPTER.mcp),
		fires: [RULE.boundaries],
	},
	{
		name: "better-sqlite3 solo vive en adapters/sqlite",
		fixture: "better-sqlite3-outside-sqlite.ts",
		as: PATH.main,
		fires: [RULE.boundaries],
	},
	{
		name: "la producción no importa dobles de testing/",
		fixture: "production-imports-testing.ts",
		as: adapter(ADAPTER.mcp),
		fires: [RULE.boundaries],
	},
	{
		name: "la producción no importa server/test/",
		fixture: "production-imports-cross-cutting-test.ts",
		as: adapter(ADAPTER.mcp),
		fires: [RULE.boundaries],
	},
	{
		name: "entre capas se importa con alias, no con relativos",
		fixture: "relative-across-layers.ts",
		as: adapter(ADAPTER.mcp),
		fires: [RULE.restricted],
	},
	{
		name: "un contrato compartido no importa nada",
		fixture: "contract-imports-something.ts",
		as: domain("activity.ts"),
		fires: [RULE.restricted],
	},
	{
		name: "la web no importa valores del contrato",
		fixture: "web-contract-value.ts",
		as: web(),
		fires: [RULE.boundaries],
	},
	{
		name: "`import { type X }` deja un import real: la web lo rechaza",
		fixture: "web-import-with-inline-type.ts",
		as: web(),
		fires: [RULE.boundaries],
	},
	{
		name: "la web solo toca los archivos del contrato, aunque sea import type",
		fixture: "web-other-server-file.ts",
		as: web(),
		fires: [RULE.boundaries],
	},
	{
		name: "la web no usa alias del servidor",
		fixture: "web-server-alias.ts",
		as: web(),
		fires: [RULE.restricted],
	},
	{
		name: "la web no importa Node",
		fixture: "web-imports-node.ts",
		as: web(),
		fires: [RULE.boundaries],
	},
	{
		name: "un átomo no importa moléculas",
		fixture: "atom-imports-molecule.svelte",
		as: at(PATH.atoms, "__Fixture__.svelte"),
		fires: [RULE.boundaries],
	},
	{
		name: "un átomo no importa organismos",
		fixture: "atom-imports-organism.ts",
		as: at(PATH.atoms, "__fixture__.ts"),
		fires: [RULE.boundaries],
	},
	{
		name: "una molécula no importa organismos",
		fixture: "molecule-imports-organism.svelte",
		as: at(PATH.molecules, "__Fixture__.svelte"),
		fires: [RULE.boundaries],
	},
	{
		name: "un átomo no importa una página",
		fixture: "atom-imports-page.svelte",
		as: at(PATH.atoms, "__Fixture__.svelte"),
		fires: [RULE.boundaries],
	},
	{
		name: "una molécula no importa una página",
		fixture: "molecule-imports-page.svelte",
		as: at(PATH.molecules, "__Fixture__.svelte"),
		fires: [RULE.boundaries],
	},
	{
		name: "un organismo no importa una página",
		fixture: "organism-imports-page.svelte",
		as: at(PATH.organisms, "__Fixture__.svelte"),
		fires: [RULE.boundaries],
	},
	{
		name: "los iconos (fundamento) no importan componentes",
		fixture: "icon-imports-atom.ts",
		as: at(PATH.icons, "__fixture__.ts"),
		fires: [RULE.boundaries],
	},
	{
		name: "el panel no importa el Chrome de captura de la web",
		fixture: "dashboard-imports-web.ts",
		as: PATH.dashboard,
		fires: [RULE.boundaries],
	},
	{
		name: "un kit no importa Node",
		fixture: "kit-imports-node.ts",
		as: at(PATH.kits, "capture/__fixture__.ts"),
		fires: [RULE.restricted],
	},
	{
		name: "un kit no importa el servidor (ni por alias ni por ruta)",
		fixture: "kit-imports-server.ts",
		as: at(PATH.kits, "capture/__fixture__.ts"),
		fires: [RULE.restricted],
	},
	{
		name: "un kit no importa paquetes (solo los tipos del API de Figma)",
		fixture: "kit-imports-other-package.ts",
		as: at(PATH.kits, "figma/__fixture__.ts"),
		fires: [RULE.restricted],
	},
];

const ALLOWED: readonly Case[] = [
	{
		name: "un kit de Figma importa los tipos del API de plugins (se borran al empaquetar)",
		fixture: "ok-kit-imports-figma-types.ts",
		as: at(PATH.kits, "figma/__fixture__.ts"),
		fires: [],
	},
	{
		name: "un kit importa sus propios módulos",
		fixture: "ok-kit-imports-own-modules.ts",
		as: at(PATH.kits, "capture/__fixture__.ts"),
		fires: [],
	},
	{
		name: "application importa domain y Node",
		fixture: "ok-application-imports-domain-and-node.ts",
		as: application(),
		fires: [],
	},
	{
		name: "un adapter importa application y domain",
		fixture: "ok-adapter-imports-application-and-domain.ts",
		as: adapter(ADAPTER.mcp),
		fires: [],
	},
	{
		name: "las raíces cablean adapters/sqlite",
		fixture: "ok-root-imports-sqlite.ts",
		as: PATH.dashboard,
		fires: [],
	},
	{
		name: "adapters/sqlite importa drizzle-orm",
		fixture: "ok-sqlite-imports-drizzle.ts",
		as: adapter(ADAPTER.sqlite),
		fires: [],
	},
	{
		name: "un test sí importa dobles de testing/",
		fixture: "ok-test-imports-testing.ts",
		as: adapter(ADAPTER.mcp, "__fixture__.test.ts"),
		fires: [],
	},
	{
		name: "la web importa el contrato con import type",
		fixture: "ok-web-import-type-from-contract.ts",
		as: web(),
		fires: [],
	},
	{
		name: "la web reexporta el contrato con export type",
		fixture: "ok-web-export-type-from-contract.ts",
		as: web(),
		fires: [],
	},
	{
		name: "una página compone organismos y, para su maquetación, moléculas, átomos e iconos",
		fixture: "ok-pagina-compone-todos-los-niveles.svelte",
		as: at(PATH.pages, "__Fixture__.svelte"),
		fires: [],
	},
	{
		name: "una molécula compone átomos e iconos",
		fixture: "ok-molecule-imports-atom-and-icon.svelte",
		as: at(PATH.molecules, "__Fixture__.svelte"),
		fires: [],
	},
	{
		name: "un átomo usa iconos",
		fixture: "ok-atom-imports-icon.svelte",
		as: at(PATH.atoms, "__Fixture__.svelte"),
		fires: [],
	},
	{
		name: "un organismo compone cualquier nivel",
		fixture: "ok-organism-imports-everything.svelte",
		as: at(PATH.organisms, "__Fixture__.svelte"),
		fires: [],
	},
];

const ids = (messages: readonly Linter.LintMessage[]) =>
	[...new Set(messages.map((m) => m.ruleId ?? "parse-error"))].sort();

describe("lint de fronteras: cada regla salta con su caso", () => {
	let eslint: ESLint;
	before(() => {
		eslint = new ESLint({
			cwd: ROOT,
			ignore: false,
			overrideConfigFile: join(ROOT, "eslint.config.ts"),
			overrideConfig: UNTYPED,
		});
	});

	const lint = async (c: Case) => {
		const code = readFileSync(join(FIXTURES, "boundaries", c.fixture), "utf8");
		const [result] = await eslint.lintText(code, {
			filePath: join(ROOT, c.as),
		});
		return ids(result?.messages ?? []);
	};

	for (const c of VIOLATIONS) {
		it(c.name, async () => {
			const found = await lint(c);
			for (const rule of c.fires) {
				assert.ok(found.includes(rule), `esperaba ${rule}; salió [${found}]`);
			}
		});
	}

	for (const c of ALLOWED) {
		it(`permitido: ${c.name}`, async () => {
			assert.deepEqual(await lint(c), []);
		});
	}
});
