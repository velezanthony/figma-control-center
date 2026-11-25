import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { cruise } from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import { PATH } from "../../eslint/architecture.ts";
import { COMPONENTS_SCRIPT } from "../src/adapters/cdp/scripts/components.ts";
import { DESIGN_CONTEXT_SCRIPT } from "../src/adapters/cdp/scripts/design-context.ts";
import { EXPORT_SCRIPT } from "../src/adapters/cdp/scripts/export.ts";
import { INSTANCES_SCRIPT } from "../src/adapters/cdp/scripts/instances.ts";
import { STYLES_SCRIPT } from "../src/adapters/cdp/scripts/styles.ts";
import { VARIABLES_SCRIPT } from "../src/adapters/cdp/scripts/variables.ts";
import { READ_KIND } from "../src/domain/catalog.ts";

// Aquí queda solo lo que no son fronteras de import: el histórico es de solo lectura, cada lado del chat tiene su raíz,
// el inquilino y el panel no manda señales. Las fronteras directas las vigila ESLint (`npm run lint`) y las capas y lo
// transitivo, dependency-cruiser (`.dependency-cruiser.mjs`, también en `npm run lint`).

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const SERVER_SRC = join(REPO_ROOT, PATH.server);
const MAIN_ROOT = join(REPO_ROOT, PATH.main);
const DASHBOARD_ROOT = join(REPO_ROOT, PATH.dashboard);
const DEPCRUISE_CONFIG = join(REPO_ROOT, ".dependency-cruiser.mjs");

// Quita comentarios antes de buscar sentencias: pueden nombrar «import»
const COMMENTS = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<![:"'])\/\/.*$/gm;
const withoutComments = (content: string): string =>
	content.replace(COMMENTS, "");

const IMPORT = /(?:from|import)\s+["']([^"']+)["']/g;

type SourceFile = { readonly path: string; readonly content: string };

const specifiersOf = (content: string): string[] =>
	[...content.matchAll(IMPORT)].flatMap((m) => (m[1] ? [m[1]] : []));

const filesIn = (dir: string, extensions: readonly string[]): SourceFile[] => {
	try {
		return readdirSync(dir, { recursive: true, withFileTypes: true })
			.filter((e) => e.isFile() && extensions.some((x) => e.name.endsWith(x)))
			.map((e) => join(e.parentPath, e.name))
			.map((path) => ({ path, content: readFileSync(path, "utf8") }));
	} catch {
		return [];
	}
};

const tsFilesIn = (dir: string): SourceFile[] => filesIn(dir, [".ts"]);

const TESTING_DIR = `${sep}testing${sep}`;
const isTest = (f: SourceFile) => f.path.endsWith(".test.ts");
const isTestingHelper = (f: SourceFile) => f.path.includes(TESTING_DIR);
// Producción: ni tests ni dobles de test
const production = (files: readonly SourceFile[]) =>
	files.filter((f) => !isTest(f) && !isTestingHelper(f));

// Todo lo que carga `entry` al ejecutarse, directa o transitivamente, según dependency-cruiser (sin `import type`,
// terceros ni Node), con la misma configuración que `npm run lint`
async function reachableFrom(entry: string): Promise<string[]> {
	const options = await extractDepcruiseOptions(DEPCRUISE_CONFIG);
	const { output } = await cruise([relative(REPO_ROOT, entry)], {
		...options,
		baseDir: REPO_ROOT,
		ruleSet: {},
	});
	if (typeof output === "string") throw new Error(output);
	return output.modules
		.map((m) => m.source)
		.filter((source) => source.startsWith(`${PATH.server}/`))
		.map((source) => join(REPO_ROOT, source));
}

const SQLITE_DIR = join(SERVER_SRC, "adapters/sqlite");
const COMPOSE_TENANT_ROOT = join(SERVER_SRC, "compose-tenant.ts");
// Las raíces de composición son las únicas que abren las conexiones del adaptador SQLite
// La sesión de un proyecto (bandejas de chat y cancelaciones) la compone compose-session.ts, montada por main.ts
const COMPOSE_SESSION_ROOT = join(SERVER_SRC, "compose-session.ts");
const SQLITE_COMPOSERS = [
	MAIN_ROOT,
	DASHBOARD_ROOT,
	COMPOSE_TENANT_ROOT,
	COMPOSE_SESSION_ROOT,
];

const HISTORY_READER = join(
	SERVER_SRC,
	"adapters/sqlite/sqlite-history-query.ts",
);
const HISTORY_PORT = join(SERVER_SRC, "application/ports/history-query.ts");
const SQL_WRITE =
	/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|VACUUM|ATTACH|PRAGMA)\b/;
const DRIZZLE_WRITE =
	/\.\s*(insert|update|delete|run|exec|transaction|prepare)\s*\(/;
const WRITE_VERB =
	/^\s+(save|insert|update|delete|record|write|set|create|add|remove|prune|import|clear|put|upsert)\w*\s*[(<]/im;
const READER_CONSTRUCTORS = [
	"SqliteHistoryQuery",
	"SqliteActivitySource",
] as const;

// El histórico de lectura (CA-8): ni el adaptador ni su puerto pueden escribir
function readOnlyViolations(file: SourceFile): string[] {
	const code = withoutComments(file.content);
	const where = relative(REPO_ROOT, file.path);
	const found: string[] = [];
	if (SQL_WRITE.test(code)) found.push(`${where}: SQL de escritura`);
	if (DRIZZLE_WRITE.test(code))
		found.push(
			`${where}: llamada que escribe (insert/update/delete/run/exec/transaction)`,
		);
	if (WRITE_VERB.test(code))
		found.push(`${where}: método con nombre de escritura`);
	// El esquema sí: el lector usa el query builder tipado (D-10). La solo lectura la da la conexión `queryOnly`
	for (const spec of specifiersOf(file.content)) {
		if (/sqlite-activity-log/.test(spec))
			found.push(`${where}: importa «${spec}» (el escritor)`);
	}
	return found;
}

// Quien instancia un lector lo hace sobre una conexión de solo consulta
function readerConnectionViolations(file: SourceFile): string[] {
	const code = withoutComments(file.content);
	return READER_CONSTRUCTORS.flatMap((name) => {
		const total = [...code.matchAll(new RegExp(`new ${name}\\(`, "g"))].length;
		const safe = [
			...code.matchAll(
				new RegExp(`new ${name}\\([\\s\\S]{0,160}?queryOnly: true`, "g"),
			),
		].length;
		return safe === total
			? []
			: [
					`${relative(REPO_ROOT, file.path)}: ${name} sin conexión de solo consulta`,
				];
	});
}

// El chat tiene dos lados en dos procesos: la sesión (MCP) recoge y responde, el panel escribe. Cada lado solo
// lo cablea su raíz, para que el proceso MCP no pueda escribir como el panel ni al revés
const CHAT_SIDE = [
	{
		adapter: "sqlite-chat",
		name: "SqliteChatMailbox",
		only: [MAIN_ROOT, COMPOSE_SESSION_ROOT],
	},
	{ adapter: "sqlite-chat", name: "SqliteChatPanel", only: [DASHBOARD_ROOT] },
	{
		adapter: "sqlite-permissions",
		name: "SqlitePermissionMailbox",
		only: [MAIN_ROOT, COMPOSE_SESSION_ROOT],
	},
	{
		adapter: "sqlite-permissions",
		name: "SqlitePermissionPanel",
		only: [DASHBOARD_ROOT],
	},
] as const;

function chatSideViolations(files: readonly SourceFile[]): string[] {
	const found: string[] = [];
	for (const file of files) {
		if (file.path.startsWith(SQLITE_DIR)) continue;
		const code = withoutComments(file.content);
		for (const side of CHAT_SIDE) {
			if (
				!side.only.some((root) => root === file.path) &&
				new RegExp(`new ${side.name}\\(`).test(code)
			) {
				found.push(
					`${relative(REPO_ROOT, file.path)}: instancia ${side.name} (solo ${side.only.map((root) => relative(REPO_ROOT, root)).join(", ")})`,
				);
			}
		}
	}
	return found;
}

describe("histórico de solo lectura (CA-8): el detector", () => {
	const at = (content: string): SourceFile => ({
		path: HISTORY_READER,
		content,
	});

	it("detecta SQL y llamadas de escritura", () => {
		assert.equal(
			readOnlyViolations(at("db.run(sql`DELETE FROM calls`);")).length,
			2,
		);
		assert.equal(
			readOnlyViolations(at("tx.insert(calls).values({});")).length,
			1,
		);
		assert.equal(
			readOnlyViolations(at("db.get(sql`UPDATE calls SET x = 1`);")).length,
			1,
		);
	});

	it("detecta un método con nombre de escritura en el puerto", () => {
		const port: SourceFile = {
			path: HISTORY_PORT,
			content: "interface P {\n  saveCall(c: C): void;\n}",
		};
		assert.equal(readOnlyViolations(port).length, 1);
		const readOnly: SourceFile = {
			path: HISTORY_PORT,
			content: "interface P {\n  summary(r: R): S;\n  calls(q: Q): P;\n}",
		};
		assert.deepEqual(readOnlyViolations(readOnly), []);
	});

	it("importar el escritor es violación; el esquema no", () => {
		assert.equal(
			readOnlyViolations(at('import { x } from "./sqlite-activity-log.ts";'))
				.length,
			1,
		);
		assert.deepEqual(
			readOnlyViolations(at('import { calls } from "./schema.ts";')),
			[],
		);
	});

	it("un comentario que nombra INSERT no es una violación", () => {
		assert.deepEqual(
			readOnlyViolations(
				at("// nunca hace INSERT ni .run(\nexport const x = 1;"),
			),
			[],
		);
	});

	it("un lector sin queryOnly en su conexión es violación", () => {
		const root = (c: string): SourceFile => ({
			path: DASHBOARD_ROOT,
			content: c,
		});
		assert.equal(
			readerConnectionViolations(
				root("new SqliteHistoryQuery({ db: openFigmaDatabase(f) })"),
			).length,
			1,
		);
		assert.deepEqual(
			readerConnectionViolations(
				root(
					"new SqliteHistoryQuery({ db: openFigmaDatabase(f, { queryOnly: true }) })",
				),
			),
			[],
		);
	});
});

describe("histórico de solo lectura (CA-8): el código real", () => {
	it("el adaptador de lectura y su puerto no exponen ninguna escritura", () => {
		for (const path of [HISTORY_READER, HISTORY_PORT]) {
			assert.deepEqual(
				readOnlyViolations({ path, content: readFileSync(path, "utf8") }),
				[],
			);
		}
	});

	it("las raíces de composición abren los lectores sobre conexiones de solo consulta", () => {
		for (const path of SQLITE_COMPOSERS) {
			assert.deepEqual(
				readerConnectionViolations({
					path,
					content: readFileSync(path, "utf8"),
				}),
				[],
			);
		}
	});
});

describe("lados del chat: el detector", () => {
	const at = (path: string, content: string): SourceFile[] => [
		{ path: join(SERVER_SRC, path), content },
	];

	it("el panel instanciando la bandeja de la sesión, o el proceso MCP escribiendo como el panel, es violación", () => {
		assert.equal(
			chatSideViolations(at("dashboard.ts", "new SqliteChatMailbox({ db })"))
				.length,
			1,
		);
		assert.equal(
			chatSideViolations(at("main.ts", "new SqliteChatPanel({ db })")).length,
			1,
		);
		assert.equal(
			chatSideViolations(at("adapters/mcp/x.ts", "new SqliteChatPanel({ db })"))
				.length,
			1,
		);
	});

	it("lo mismo con los permisos: el panel no recoge veredictos y el proceso MCP no decide", () => {
		assert.equal(
			chatSideViolations(
				at("dashboard.ts", "new SqlitePermissionMailbox({ db })"),
			).length,
			1,
		);
		assert.equal(
			chatSideViolations(at("main.ts", "new SqlitePermissionPanel({ db })"))
				.length,
			1,
		);
		assert.deepEqual(
			chatSideViolations(at("main.ts", "new SqlitePermissionMailbox({ db })")),
			[],
		);
		assert.deepEqual(
			chatSideViolations(
				at("dashboard.ts", "new SqlitePermissionPanel({ db })"),
			),
			[],
		);
	});

	it("cada raíz con su lado, y un comentario que lo nombre no cuenta", () => {
		assert.deepEqual(
			chatSideViolations(at("main.ts", "new SqliteChatMailbox({ db })")),
			[],
		);
		assert.deepEqual(
			chatSideViolations(at("dashboard.ts", "new SqliteChatPanel({ db })")),
			[],
		);
		assert.deepEqual(
			chatSideViolations(
				at("main.ts", "// nunca new SqliteChatPanel(x)\nexport const a = 1;"),
			),
			[],
		);
	});
});

describe("lados del chat: el código real", () => {
	it("main.ts solo cablea la bandeja de la sesión y dashboard.ts solo el lado del panel", () => {
		assert.deepEqual(chatSideViolations(production(tsFilesIn(SERVER_SRC))), []);
	});
});

// Inquilino lógico: las tablas de datos de proyecto solo se consultan en los repositorios
// acotados, y cada uno de ellos recibe el `projectId` al crearse. Así olvidar el filtro por proyecto no es posible desde
// fuera, y dentro lo vigilan los tests de aislamiento (sqlite-isolation.int.test.ts)
const PROJECT_TABLES = [
	"sessions",
	"events",
	"calls",
	"jobs",
	"build_steps",
	"call_nodes",
	"nodes_touched",
	"captures",
	"meta",
	"chat_messages",
	"permission_requests",
	"cancel_requests",
	"script_blobs",
	"attempts",
	"attempt_scripts",
	"calls_fts",
	"chat_messages_fts",
] as const;
const SCOPED_REPOSITORIES = [
	"sqlite-activity-log.ts",
	"sqlite-activity-source.ts",
	"sqlite-attempt-log.ts",
	"sqlite-attempt-query.ts",
	"sqlite-cancel-requests.ts",
	"sqlite-chat.ts",
	"sqlite-history-query.ts",
	"sqlite-permissions.ts",
].map((name) => join(SQLITE_DIR, name));
const TABLE_NAMES = PROJECT_TABLES.join("|");
const SQL_ON_TABLE = new RegExp(
	`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?:${TABLE_NAMES})\\b`,
	"i",
);
const SCHEMA_IMPORT =
	/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*schema\.ts["']/g;
const PROJECT_TABLE_SYMBOLS = new Set([
	"sessions",
	"events",
	"calls",
	"jobs",
	"buildSteps",
	"callNodes",
	"nodesTouched",
	"captures",
	"meta",
	"chatMessages",
	"permissionRequests",
	"cancelRequests",
	"scriptBlobs",
	"attempts",
	"attemptScripts",
]);

// Quien consulta una tabla de proyecto sin ser un repositorio acotado: importa su tabla del esquema o escribe SQL sobre ella
function projectTableViolations(file: SourceFile): string[] {
	if (SCOPED_REPOSITORIES.includes(file.path)) return [];
	const code = withoutComments(file.content);
	const where = relative(REPO_ROOT, file.path);
	const found: string[] = [];
	for (const m of code.matchAll(SCHEMA_IMPORT)) {
		const names = (m[1] ?? "").split(",").map(
			(n) =>
				n
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)[0] ?? "",
		);
		for (const name of names) {
			if (PROJECT_TABLE_SYMBOLS.has(name)) {
				found.push(
					`${where}: importa la tabla «${name}» fuera de un repositorio acotado`,
				);
			}
		}
	}
	if (SQL_ON_TABLE.test(code)) {
		found.push(
			`${where}: SQL sobre una tabla de proyecto fuera de un repositorio acotado`,
		);
	}
	return found;
}

// Un repositorio acotado declara que recibe el proyecto y no lo deja opcional
function unscopedRepositoryViolations(file: SourceFile): string[] {
	const code = withoutComments(file.content);
	return /readonly projectId: number\b/.test(code)
		? []
		: [
				`${relative(REPO_ROOT, file.path)}: su constructor no recibe projectId: number`,
			];
}

describe("inquilino lógico: el detector", () => {
	const at = (name: string, content: string): SourceFile => ({
		path: join(SERVER_SRC, name),
		content,
	});

	it("una consulta de una tabla de proyecto fuera de un repositorio acotado es violación", () => {
		assert.equal(
			projectTableViolations(
				at("adapters/sqlite/otro.ts", "db.all(sql`SELECT * FROM calls`);"),
			).length,
			1,
		);
		assert.equal(
			projectTableViolations(
				at(
					"application/x.ts",
					'import { calls, jobs } from "#adapters/sqlite/schema.ts";',
				),
			).length,
			2,
		);
		assert.equal(
			projectTableViolations(
				at(
					"adapters/sqlite/otro.ts",
					"tx.run(sql`insert into chat_messages(a)`);",
				),
			).length,
			1,
		);
	});

	it("dentro de un repositorio acotado, y con la tabla de proyectos o un comentario, no lo es", () => {
		assert.deepEqual(
			projectTableViolations({
				path: SCOPED_REPOSITORIES[0] ?? "",
				content: "db.all(sql`SELECT * FROM calls`);",
			}),
			[],
		);
		assert.deepEqual(
			projectTableViolations(
				at(
					"adapters/sqlite/sqlite-registry.ts",
					"db.select().from(projects); // nunca FROM calls",
				),
			),
			[],
		);
		assert.deepEqual(
			projectTableViolations(
				at("x.ts", 'import { projects } from "./schema.ts";'),
			),
			[],
		);
	});

	it("un repositorio que no recibe projectId es violación", () => {
		assert.equal(
			unscopedRepositoryViolations(
				at(
					"adapters/sqlite/sqlite-chat.ts",
					"constructor(options: { readonly db: Db }) {}",
				),
			).length,
			1,
		);
		assert.deepEqual(
			unscopedRepositoryViolations(
				at(
					"adapters/sqlite/sqlite-chat.ts",
					"constructor(options: { readonly db: Db; readonly projectId: number }) {}",
				),
			),
			[],
		);
	});
});

describe("inquilino lógico: el código real", () => {
	it("el esquema tiene las mismas tablas de proyecto que vigila este test (no se cuela una sin project_id)", () => {
		const schema = readFileSync(join(SQLITE_DIR, "schema.ts"), "utf8");
		const tables = [...schema.matchAll(/sqliteTable\(\s*"([a-z_]+)"/g)].map(
			(m) => m[1],
		);
		assert.deepEqual(
			// `projects` y `settings` son de la máquina, no de un proyecto
			tables.filter((t) => t !== "projects" && t !== "settings").sort(),
			PROJECT_TABLES.filter((t) => !t.endsWith("_fts")).sort(),
		);
	});

	it("ninguna consulta de una tabla de proyecto se construye fuera de los repositorios acotados", () => {
		const files = production(tsFilesIn(SERVER_SRC)).filter(
			(f) => !f.path.endsWith(join("adapters", "sqlite", "schema.ts")),
		);
		assert.deepEqual(files.flatMap(projectTableViolations), []);
	});

	it("cada repositorio acotado recibe el projectId al crearse", () => {
		for (const path of SCOPED_REPOSITORIES) {
			assert.deepEqual(
				unscopedRepositoryViolations({
					path,
					content: readFileSync(path, "utf8"),
				}),
				[],
			);
		}
	});
});

// El panel nunca mata procesos: «Cerrar agente» manda `close` por la vigilancia y el cierre lo
// hace agent-run.ts. Mirar si un pid vive (`process.kill(pid, 0)`) no manda ninguna señal y sí vale
const SENDS_SIGNAL = /\.kill\(\s*(?![^,()]+,\s*0\s*\))/;

async function signalSenders(root: string): Promise<readonly string[]> {
	return (await reachableFrom(root))
		.filter((file) =>
			SENDS_SIGNAL.test(readFileSync(file, "utf8").replace(COMMENTS, "")),
		)
		.map((file) => relative(REPO_ROOT, file));
}

describe("el panel no mata procesos", () => {
	it("el detector ve una señal a un hijo o a un pid, y no ve mirar si un pid vive", () => {
		assert.equal(SENDS_SIGNAL.test('child.kill("SIGTERM")'), true);
		assert.equal(SENDS_SIGNAL.test("process.kill(pid, 'SIGKILL')"), true);
		assert.equal(SENDS_SIGNAL.test("process.kill(-pid)"), true);
		assert.equal(SENDS_SIGNAL.test("process.kill(pid, 0)"), false);
	});

	it("nada de lo que carga dashboard.ts manda una señal a un proceso", async () => {
		// El recorrido es real: agent-run.ts, que sí cierra a claude, se detecta
		assert.ok(
			(await signalSenders(join(SERVER_SRC, "agent-run.ts"))).includes(
				`${PATH.server}/agent-run.ts`,
			),
		);
		assert.deepEqual(await signalSenders(DASHBOARD_ROOT), []);
	});
});

// Los scripts internos de lectura no llaman al API que muta el archivo. Se mira el script TAL
// COMO se envía a Figma (un texto fijo: la entrada va en `params`), no el .ts: lo que importa es lo que se evalúa.
// `figma.skipInvisibleInstanceChildren` es un ajuste del script, no del documento, y sí vale
const MUTATING_CALLS: readonly RegExp[] = [
	/\bcreate[A-Z]\w*\s*\(/,
	/\.remove\s*\(/,
	/\.set[A-Z]\w*\s*\(/,
	/\.(?:appendChild|insertChild)\s*\(/,
	/\.(?:resize|resizeWithoutConstraints|rescale|clone|flatten|detachInstance|swapComponent|createInstance|combineAsVariants|commitUndo|import\w*Async)\s*\(/,
	/\.(?:name|fills|strokes|effects|characters|visible|opacity|x|y|currentPage|description)\s*=(?!=)/,
];

const mutationsIn = (script: string): string[] =>
	MUTATING_CALLS.filter((re) => re.test(script.replace(COMMENTS, ""))).map(
		(re) => re.source,
	);

const READ_SCRIPTS: Readonly<Record<string, string>> = {
	[READ_KIND.variables]: VARIABLES_SCRIPT,
	[READ_KIND.styles]: STYLES_SCRIPT,
	[READ_KIND.components]: COMPONENTS_SCRIPT,
	[READ_KIND.instances]: INSTANCES_SCRIPT,
	[READ_KIND.export]: EXPORT_SCRIPT,
	[READ_KIND.designContext]: DESIGN_CONTEXT_SCRIPT,
};

describe("las lecturas no escriben: el detector", () => {
	it("ve crear, borrar, cambiar, insertar, redimensionar, importar o asignar propiedades de un nodo", () => {
		for (const bad of [
			"const f = figma.createFrame();",
			"figma.variables.createVariable('x', c, 'COLOR');",
			"node.remove();",
			"v.setValueForMode(m, 1);",
			"await node.setBoundVariable('fills', v);",
			"page.appendChild(f);",
			"frame.insertChild(0, f);",
			"node.resize(10, 10);",
			"await figma.importComponentByKeyAsync(k);",
			"node.name = 'x';",
			"figma.currentPage = page;",
		]) {
			assert.notDeepEqual(mutationsIn(bad), [], bad);
		}
	});

	it("no ve leer, contar en un Map/Set ni el ajuste skipInvisibleInstanceChildren", () => {
		for (const good of [
			"const s = new Set(ids); const m = new Map(); m.set(k, v); m.get(k);",
			"figma.skipInvisibleInstanceChildren = true;",
			"counts[name] = (counts[name] ?? 0) + 1;",
			"await page.loadAsync(); const b = await node.exportAsync(settings);",
			"if (node.name === QUERY.page) return;",
			"// node.remove() en un comentario",
		]) {
			assert.deepEqual(mutationsIn(good), [], good);
		}
	});
});

describe("las lecturas no escriben: el código real", () => {
	it("hay un script interno por cada lectura", () => {
		assert.deepEqual(
			Object.keys(READ_SCRIPTS).sort(),
			Object.values(READ_KIND).sort(),
		);
	});

	for (const [kind, script] of Object.entries(READ_SCRIPTS)) {
		it(`el script interno de ${kind} no llama a nada que mute el archivo`, () => {
			assert.deepEqual(mutationsIn(script), []);
		});
	}
});

// El proceso Node nunca ejecuta código del proyecto: los ganchos se leen como texto y
// solo los evalúa el kit en el mundo aislado de la página. En producción no hay eval, new Function, node:vm ni un
// import() dinámico (de una ruta que no sea un literal)
const RUNS_CODE: readonly RegExp[] = [
	/\beval\s*\(/,
	/\bnew\s+Function\s*\(/,
	/["']node:vm["']|["']vm["']/,
	/\bimport\s*\(\s*(?!["'][^"']+["']\s*\))/,
];
const runsCode = (content: string): boolean =>
	RUNS_CODE.some((r) => r.test(withoutComments(content)));

describe("el servidor no ejecuta código del proyecto", () => {
	it("el detector ve eval, new Function, node:vm y un import() dinámico, y no un import() de un literal", () => {
		assert.equal(runsCode("eval(code)"), true);
		assert.equal(runsCode("const f = new Function('a', body)"), true);
		assert.equal(runsCode('import { runInContext } from "node:vm";'), true);
		assert.equal(runsCode("await import(hooksPath)"), true);
		assert.equal(runsCode('await import("./fijo.ts")'), false);
		assert.equal(runsCode("// eval(x) en un comentario"), false);
	});

	it("ningún fichero de producción de server/src ejecuta código", () => {
		assert.deepEqual(
			production(tsFilesIn(SERVER_SRC))
				.filter((f) => runsCode(f.content))
				.map((f) => relative(REPO_ROOT, f.path)),
			[],
		);
	});
});

// P1: la herramienta es genérica. Ningún nombre propio de la web que se captura en el
// código del servidor ni en los kits (fuentes y empaquetado); lo de cada web va en su configuración, en su repo. Los
// datos de ejemplo de los tests no cuentan: no son la herramienta
const WEB_NAMES = [
	"djDebug",
	"x-data",
	"x-cloak",
	"Alpine",
	"csrfmiddlewaretoken",
	"toast",
] as const;
const KITS_DIR = join(REPO_ROOT, "kits");

describe("la captura es genérica: nada de una web real en server/src ni en kits/", () => {
	it("el detector ve un nombre de web sin distinguir mayúsculas", () => {
		const found = (text: string) =>
			WEB_NAMES.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
		assert.deepEqual(found("quita [x-data*=toast]"), ["x-data", "toast"]);
		assert.deepEqual(found("ALPINE"), ["Alpine"]);
	});

	it("cero en la producción de server/src y en kits/", () => {
		const files = [
			...production(tsFilesIn(SERVER_SRC)),
			...filesIn(KITS_DIR, [".ts", ".js"]).filter((f) => !isTest(f)),
		];
		const hits = files.flatMap((f) =>
			WEB_NAMES.filter((n) =>
				f.content.toLowerCase().includes(n.toLowerCase()),
			).map((n) => `${relative(REPO_ROOT, f.path)}: ${n}`),
		);
		assert.deepEqual(hits, []);
	});
});

// El Chrome de captura nunca es el de Figma: adapters/web no conoce el puerto de Figma
describe("el adaptador de la captura no recibe el puerto del Chrome de Figma", () => {
	it("nada de adapters/web nombra FIGMA_CDP_PORT ni la config cdp", () => {
		const hits = production(tsFilesIn(join(SERVER_SRC, "adapters/web")))
			.filter((f) =>
				/FIGMA_CDP_PORT|\bcdp\.port\b|machine\.cdp/.test(
					withoutComments(f.content),
				),
			)
			.map((f) => relative(REPO_ROOT, f.path));
		assert.deepEqual(hits, []);
	});
});
