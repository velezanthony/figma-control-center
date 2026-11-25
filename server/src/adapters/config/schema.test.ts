import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { RegistryEntry } from "#domain/registry.ts";
import { DASHBOARD_MODE } from "#domain/settings.ts";
import {
	BOOT_KEYS,
	describeSettings,
	EDITABLE_KEYS,
	ENV_KEYS,
	editableKeyProblem,
	FILE_URL_IGNORED_WARNING,
	isSettingDefault,
	normalizeSetting,
	parseConfig,
	parseLayered,
	REPO_ROOT,
	SETTING_INFO,
	setByEnvironment,
	tenantFromEntry,
	validateSetting,
} from "./schema.ts";

// Config mínima: lo único obligatorio es FIGMA_FILE_URL; el resto toma su valor por defecto
const VALID = {
	FIGMA_FILE_URL: "https://www.figma.com/design/abc/Nombre",
} as const;

const ORIGIN = ".env de prueba";

describe("parseConfig: URL del archivo", () => {
	for (const name of ["FIGMA_FILE_URL", "FIGMA_TEST_FILE_URL"] as const) {
		for (const [what, url] of [
			[
				"query string",
				"https://www.figma.com/design/abc/Nombre?node-id=1-2&p=f",
			],
			["fragmento", "https://www.figma.com/design/abc/Nombre#algo"],
		] as const) {
			it(`una ${name} con ${what} es un error que nombra la variable y dice quitar desde «?»`, () => {
				assert.throws(
					() => parseConfig({ ...VALID, [name]: url }, ORIGIN),
					(e: Error) => e.message.includes(name) && e.message.includes("?"),
				);
			});
		}
	}
});

describe("parseConfig: perfil de Chrome", () => {
	it("es opcional y por defecto usa ~/.cache/figma-control-center-chrome", () => {
		// VALID ya no trae FIGMA_CHROME_PROFILE: aquí se comprueba el valor por defecto
		assert.equal(
			parseConfig(VALID, ORIGIN).chrome.profile,
			resolve(homedir(), ".cache/figma-control-center-chrome"),
		);
	});

	it("un valor lo sobrescribe", () => {
		assert.equal(
			parseConfig({ ...VALID, FIGMA_CHROME_PROFILE: "~/.cache/otro" }, ORIGIN)
				.chrome.profile,
			resolve(homedir(), ".cache/otro"),
		);
	});
});

describe("parseConfig: perfil semilla", () => {
	it("con FIGMA_CHROME_SEED_PROFILE lo expone como ruta absoluta", () => {
		const c = parseConfig(
			{ ...VALID, FIGMA_CHROME_SEED_PROFILE: "~/.cache/semilla" },
			ORIGIN,
		);
		assert.equal(c.chrome.seedProfile, resolve(homedir(), ".cache/semilla"));
	});
});

describe("parseConfig", () => {
	it("FCC_SCRIPTS_ROOT admite varias rutas separadas por «:» y las hace absolutas", () => {
		const c = parseConfig(
			{ ...VALID, FCC_SCRIPTS_ROOT: "scripts:/tmp/otros" },
			ORIGIN,
		);
		assert.deepEqual(c.scripts.roots, [
			resolve(REPO_ROOT, "scripts"),
			"/tmp/otros",
		]);
	});

	it("expone el histórico, el seguimiento en vivo y el chat", () => {
		const c = parseConfig(VALID, ORIGIN);
		assert.deepEqual(c.history, {
			dbPath: resolve(REPO_ROOT, "output/history.db"),
			retentionDays: 90,
			maxRows: 200,
			stepExcerptBytes: 300,
			scriptMaxBytes: 2_000_000,
			diffInlineLines: 200,
		});
		assert.deepEqual(c.live, { pollMs: 500 });
		assert.deepEqual(c.chat, {
			pollMs: 700,
			tokensDir: resolve(REPO_ROOT, "output/chat-tokens"),
			agent: false,
		});
	});

	it("la terminal del agente se parte en argumentos, sin pasar por un shell", () => {
		assert.deepEqual(parseConfig(VALID, ORIGIN).agent, {
			terminal: ["gnome-terminal", "--"],
			launchTimeoutMs: 120_000,
		});
		const spaced = parseConfig(
			{ ...VALID, FCC_AGENT_TERMINAL: "  xterm   -e  " },
			ORIGIN,
		);
		assert.deepEqual(spaced.agent.terminal, ["xterm", "-e"]);
	});

	it("la terminal del agente no puede estar vacía", () => {
		for (const blank of ["", "   "]) {
			assert.throws(
				() => parseConfig({ ...VALID, FCC_AGENT_TERMINAL: blank }, ORIGIN),
				(e: Error) => e.message.includes("FCC_AGENT_TERMINAL"),
				JSON.stringify(blank),
			);
		}
	});

	it("el panel solo puede escuchar en loopback", () => {
		for (const host of ["0.0.0.0", "192.168.1.5", "example.com"]) {
			assert.throws(
				() => parseConfig({ ...VALID, FCC_DASHBOARD_HOST: host }, ORIGIN),
				(e: Error) => e.message.includes("FCC_DASHBOARD_HOST"),
				host,
			);
		}
		for (const host of ["127.0.0.1", "localhost", "::1"]) {
			assert.equal(
				parseConfig({ ...VALID, FCC_DASHBOARD_HOST: host }, ORIGIN).dashboard
					.host,
				host,
			);
		}
	});

	for (const name of Object.keys(VALID)) {
		it(`falta ${name}: el error nombra la variable`, () => {
			const { [name as keyof typeof VALID]: _omit, ...rest } = VALID;
			assert.throws(
				() => parseConfig(rest, ORIGIN),
				(e: Error) => e.message.includes(name),
			);
		});
	}
});

describe("parseLayered: config en capas", () => {
	it("separa la config de máquina y el alcance; FIGMA_FILE_URL no crea ningún proyecto (D-1)", () => {
		const layered = parseLayered(VALID, ORIGIN);
		const { machine, scope } = layered;
		// Máquina: lo compartido (con su default)
		assert.equal(machine.cdp.port, 9222);
		assert.equal(machine.scriptsBaseDir, REPO_ROOT);
		assert.equal(machine.dashboard.port, 4173);
		assert.deepEqual(scope, { kind: "any" });
		// El archivo de Figma es de cada proyecto, no del .env
		assert.equal("defaultTenant" in layered, false);
	});

	it("el aviso de FIGMA_FILE_URL dice qué hacer y no menciona una «Base SQLite» que ya no existe", () => {
		assert.match(FILE_URL_IGNORED_WARNING, /Proyectos/);
		assert.doesNotMatch(FILE_URL_IGNORED_WARNING, /Base SQLite/);
	});

	it("si el entorno fija FIGMA_FILE_URL se anota para avisar de que ya no se usa", () => {
		assert.equal(parseLayered(VALID, ORIGIN).fileUrlIgnored, true);
		const { FIGMA_FILE_URL: _omit, ...none } = VALID;
		assert.equal(parseLayered(none, ORIGIN).fileUrlIgnored, false);
	});

	it("FCC_PROJECTS por defecto es alcance 'any'", () => {
		assert.deepEqual(parseLayered(VALID, ORIGIN).scope, { kind: "any" });
	});

	it("FCC_PROJECTS con ids los separa por comas y los limpia", () => {
		const { scope } = parseLayered(
			{ ...VALID, FCC_PROJECTS: "ejemplo, cliente ,  " },
			ORIGIN,
		);
		assert.deepEqual(scope, { kind: "ids", ids: ["ejemplo", "cliente"] });
	});

	it("FCC_PROJECTS vacío, solo comas o solo espacios no da acceso a nada", () => {
		for (const value of ["", "   ", ",", " , ,"]) {
			assert.deepEqual(
				parseLayered({ ...VALID, FCC_PROJECTS: value }, ORIGIN).scope,
				{ kind: "ids", ids: [] },
				`«${value}»`,
			);
		}
	});

	it("FCC_PROJECTS 'any' explícito es alcance 'any'", () => {
		assert.deepEqual(
			parseLayered({ ...VALID, FCC_PROJECTS: "any" }, ORIGIN).scope,
			{ kind: "any" },
		);
	});
});

describe("parseLayered: el lanzador del agente", () => {
	it("sin fijar, claude es el del PATH y no es el entorno de pruebas", () => {
		const { agent } = parseLayered(VALID, ORIGIN).machine;
		assert.equal(agent.claudeBin, null);
		assert.equal(agent.testHarness, false);
	});

	it("FCC_CLAUDE_BIN (solo lo fijan los tests) se hace absoluta y FCC_TEST_HARNESS marca el entorno de pruebas", () => {
		const { agent } = parseLayered(
			{
				...VALID,
				FCC_CLAUDE_BIN: "/tmp/falso/claude",
				FCC_TEST_HARNESS: "1",
			},
			ORIGIN,
		).machine;
		assert.equal(agent.claudeBin, "/tmp/falso/claude");
		assert.equal(agent.testHarness, true);
	});

	it("la vigilancia del panel: 10 s de margen y un reintento por segundo, editables", () => {
		assert.deepEqual(
			{
				graceMs: parseLayered(VALID, ORIGIN).machine.agent.panelGraceMs,
				retryMs: parseLayered(VALID, ORIGIN).machine.agent.watchRetryMs,
			},
			{ graceMs: 10_000, retryMs: 1000 },
		);
		const set = parseLayered(
			{
				...VALID,
				FCC_AGENT_PANEL_GRACE_MS: "300",
				FCC_AGENT_WATCH_RETRY_MS: "50",
			},
			ORIGIN,
		).machine.agent;
		assert.equal(set.panelGraceMs, 300);
		assert.equal(set.watchRetryMs, 50);
		for (const key of [
			"FCC_AGENT_PANEL_GRACE_MS",
			"FCC_AGENT_WATCH_RETRY_MS",
		]) {
			assert.ok((EDITABLE_KEYS as readonly string[]).includes(key), key);
			assert.throws(
				() => parseLayered({ ...VALID, [key]: "0" }, ORIGIN),
				(e: Error) => e.message.includes(key),
				key,
			);
		}
	});

	it("el tope de nodos de figma_export: 20 por defecto, editable y en las dos configuraciones", () => {
		assert.equal(parseLayered(VALID, ORIGIN).machine.read.exportMaxNodes, 20);
		assert.equal(parseConfig(VALID, ORIGIN).read.exportMaxNodes, 20);
		assert.equal(
			parseLayered({ ...VALID, FIGMA_EXPORT_MAX_NODES: "5" }, ORIGIN).machine
				.read.exportMaxNodes,
			5,
		);
		assert.ok(
			(EDITABLE_KEYS as readonly string[]).includes("FIGMA_EXPORT_MAX_NODES"),
		);
	});

	it("el tope de nodos de figma_design_context: 400 por defecto, editable y en las dos configuraciones", () => {
		assert.equal(
			parseLayered(VALID, ORIGIN).machine.read.designContextMaxNodes,
			400,
		);
		assert.equal(parseConfig(VALID, ORIGIN).read.designContextMaxNodes, 400);
		assert.equal(
			parseLayered({ ...VALID, FIGMA_DESIGN_CONTEXT_MAX_NODES: "150" }, ORIGIN)
				.machine.read.designContextMaxNodes,
			150,
		);
		assert.ok(
			(EDITABLE_KEYS as readonly string[]).includes(
				"FIGMA_DESIGN_CONTEXT_MAX_NODES",
			),
		);
	});

	it("un FIGMA_DESIGN_CONTEXT_MAX_NODES que no es un entero positivo es un error que nombra la variable", () => {
		for (const bad of ["0", "-3", "abc", "1.5"]) {
			assert.throws(
				() =>
					parseLayered(
						{ ...VALID, FIGMA_DESIGN_CONTEXT_MAX_NODES: bad },
						ORIGIN,
					),
				(e: Error) => e.message.includes("FIGMA_DESIGN_CONTEXT_MAX_NODES"),
				bad,
			);
		}
	});

	it("un FIGMA_EXPORT_MAX_NODES que no es un entero positivo es un error que nombra la variable", () => {
		for (const bad of ["0", "-3", "abc", "1.5"]) {
			assert.throws(
				() => parseLayered({ ...VALID, FIGMA_EXPORT_MAX_NODES: bad }, ORIGIN),
				(e: Error) => e.message.includes("FIGMA_EXPORT_MAX_NODES"),
				bad,
			);
		}
	});

	it("expone la raíz de scripts por defecto de la máquina (la que el arnés no deja usar)", () => {
		assert.deepEqual(parseLayered(VALID, ORIGIN).defaultScriptsRoots, [
			resolve(REPO_ROOT, "scripts"),
		]);
	});
});

describe("parseLayered: la base única", () => {
	it("FCC_DB por defecto es output/figma.db del repo; un valor la sobrescribe", () => {
		assert.equal(
			parseLayered(VALID, ORIGIN).machine.dbPath,
			resolve(REPO_ROOT, "output/figma.db"),
		);
		assert.equal(
			parseLayered({ ...VALID, FCC_DB: "~/.cache/figma.db" }, ORIGIN).machine
				.dbPath,
			resolve(homedir(), ".cache/figma.db"),
		);
	});

	it("la salida de los ficheros por defecto sale de FCC_OUTPUT_DIR y es la carpeta donde se pone cada proyecto", () => {
		const layered = parseLayered(
			{ ...VALID, FCC_OUTPUT_DIR: "/datos/salida" },
			ORIGIN,
		);
		assert.equal(layered.outputRoot, "/datos/salida");
		assert.equal(layered.outputDirFor("7"), "/datos/salida/7");
	});
});

describe("parseLayered: carpeta de los locks de lote (entre procesos)", () => {
	it("por defecto es una carpeta de la máquina, no del proyecto ni de FCC_OUTPUT_DIR (todas las sesiones la comparten)", () => {
		const expected = resolve(homedir(), ".cache/figma-control-center-locks");
		assert.equal(parseLayered(VALID, ORIGIN).machine.locksDir, expected);
		assert.equal(
			parseLayered({ ...VALID, FCC_OUTPUT_DIR: "/otra/salida" }, ORIGIN).machine
				.locksDir,
			expected,
		);
	});

	it("FCC_LOCK_DIR la sobrescribe", () => {
		assert.equal(
			parseLayered({ ...VALID, FCC_LOCK_DIR: "/tmp/locks" }, ORIGIN).machine
				.locksDir,
			"/tmp/locks",
		);
	});
});

describe("tenantFromEntry: defaults centralizados por id", () => {
	const base = {
		id: "ejemplo",
		name: "Ejemplo",
		projectDir: "/p/ejemplo",
		fileUrl: "https://www.figma.com/design/abc/Ejemplo",
	};
	const DEFAULT_ROOTS = [resolve(REPO_ROOT, "scripts")];
	const DEFAULTS = {
		scriptsRoots: DEFAULT_ROOTS,
		outputDir: resolve(REPO_ROOT, "output"),
	};

	it("sin campos opcionales: salida/base por id, scripts al default de máquina", () => {
		const t = tenantFromEntry(base, DEFAULTS);
		assert.equal(t.outputDir, resolve(REPO_ROOT, "output/ejemplo"));
		assert.equal(
			t.activityFile,
			resolve(REPO_ROOT, "output/ejemplo/activity.jsonl"),
		);
		assert.deepEqual(t.scriptsRoots, DEFAULT_ROOTS);
		assert.equal(t.fileUrl, base.fileUrl);
	});

	it("con overrides: usa los valores de la fila, hechos absolutos", () => {
		const t = tenantFromEntry(
			{
				...base,
				outputDir: "~/.cache/z",
				scriptsRoots: ["scripts", "/tmp/x"],
			},
			DEFAULTS,
		);
		assert.equal(t.outputDir, resolve(homedir(), ".cache/z"));
		assert.deepEqual(t.scriptsRoots, [resolve(REPO_ROOT, "scripts"), "/tmp/x"]);
		assert.equal(t.activityFile, resolve(homedir(), ".cache/z/activity.jsonl"));
	});
});

describe("rutas por defecto: siguen a FCC_OUTPUT_DIR", () => {
	const OUT = "/datos/salida";
	const base: RegistryEntry = {
		id: "ejemplo",
		name: "Ejemplo",
		projectDir: "/p/ejemplo",
		fileUrl: "https://www.figma.com/design/abc/Ejemplo",
	};

	it("el histórico y el registro de actividad de la config plana cuelgan de FCC_OUTPUT_DIR", () => {
		const config = parseConfig({ ...VALID, FCC_OUTPUT_DIR: OUT }, ORIGIN);
		assert.equal(config.output.dir, OUT);
		assert.equal(config.history.dbPath, `${OUT}/history.db`);
		assert.equal(config.activity.file, `${OUT}/activity.jsonl`);
	});

	it("FCC_DB_PATH y FCC_ACTIVITY_FILE explícitos mandan sobre lo derivado", () => {
		const config = parseConfig(
			{
				...VALID,
				FCC_OUTPUT_DIR: OUT,
				FCC_DB_PATH: "/otro/h.db",
				FCC_ACTIVITY_FILE: "/otro/a.jsonl",
			},
			ORIGIN,
		);
		assert.equal(config.history.dbPath, "/otro/h.db");
		assert.equal(config.activity.file, "/otro/a.jsonl");
	});

	it("sin FCC_OUTPUT_DIR, todo sigue donde estaba (output/ del repo)", () => {
		const config = parseConfig(VALID, ORIGIN);
		assert.equal(
			config.history.dbPath,
			resolve(REPO_ROOT, "output/history.db"),
		);
		assert.equal(
			config.activity.file,
			resolve(REPO_ROOT, "output/activity.jsonl"),
		);
	});

	it("si la base antigua (output/ del repo) existe y la nueva no, se usa la antigua y se avisa", () => {
		const legacyDb = resolve(REPO_ROOT, "output/history.db");
		const warnings: string[] = [];
		const config = parseConfig({ ...VALID, FCC_OUTPUT_DIR: OUT }, ORIGIN, {
			exists: (p) => p === legacyDb,
			warn: (m) => warnings.push(m),
		});
		assert.equal(config.history.dbPath, legacyDb);
		assert.equal(config.activity.file, `${OUT}/activity.jsonl`);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] ?? "", /history\.db/);
		assert.match(warnings[0] ?? "", /FCC_DB_PATH/);
	});

	it("si existen las dos, manda la nueva y no se avisa", () => {
		const warnings: string[] = [];
		const config = parseConfig({ ...VALID, FCC_OUTPUT_DIR: OUT }, ORIGIN, {
			exists: () => true,
			warn: (m) => warnings.push(m),
		});
		assert.equal(config.history.dbPath, `${OUT}/history.db`);
		assert.deepEqual(warnings, []);
	});

	it("la carpeta de una fila del registro cuelga de FCC_OUTPUT_DIR", () => {
		const t = tenantFromEntry(base, { scriptsRoots: [], outputDir: OUT });
		assert.equal(t.outputDir, `${OUT}/ejemplo`);
		assert.equal(t.activityFile, `${OUT}/ejemplo/activity.jsonl`);
	});

	it("layered.resolveEntry aplica los mismos defaults que tenantFromEntry", () => {
		const layered = parseLayered({ ...VALID, FCC_OUTPUT_DIR: OUT }, ORIGIN);
		assert.equal(layered.resolveEntry(base).outputDir, `${OUT}/ejemplo`);
	});
});

describe("parseLayered: sin FIGMA_FILE_URL", () => {
	const { FIGMA_FILE_URL: _omit, ...NONE } = VALID;

	it("el panel puede arrancar: el resto de la config sigue", () => {
		const layered = parseLayered(NONE, ORIGIN);
		assert.equal(layered.machine.dashboard.port, 4173);
	});

	it("las filas del registro siguen resolviéndose", () => {
		const layered = parseLayered(NONE, ORIGIN);
		const t = layered.resolveEntry({
			id: "ejemplo",
			name: "Ejemplo",
			projectDir: "/p",
			fileUrl: "https://www.figma.com/design/abc/Ejemplo",
		});
		assert.equal(t.id, "ejemplo");
		assert.deepEqual(t.scriptsRoots, [resolve(REPO_ROOT, "scripts")]);
	});

	it("parseConfig (API de pruebas) sigue exigiéndola y el error nombra la variable", () => {
		assert.throws(
			() => parseConfig(NONE, ORIGIN),
			(e: Error) => e.message.includes("FIGMA_FILE_URL"),
		);
	});
});

describe("FIGMA_FILE_URL: la misma regla que el registro y el panel", () => {
	for (const [what, url] of [
		["sin clave", "https://www.figma.com/design/"],
		["de otro dominio", "https://example.com/design/abc/N"],
		["de otra sección", "https://www.figma.com/community/file/abc"],
	] as const) {
		it(`una URL ${what} se rechaza y el error nombra la variable`, () => {
			assert.throws(
				() => parseLayered({ FIGMA_FILE_URL: url }, ORIGIN),
				(e: Error) => e.message.includes("FIGMA_FILE_URL"),
			);
		});
	}
});

describe("ajustes del panel: cada variable es editable o de arranque", () => {
	it("ninguna variable queda sin clasificar, ninguna está en las dos listas y todas existen", () => {
		const editable = new Set<string>(EDITABLE_KEYS);
		const boot = new Set<string>(BOOT_KEYS);
		const all = new Set<string>(ENV_KEYS);
		assert.deepEqual(
			[...all].filter((k) => !editable.has(k) && !boot.has(k)),
			[],
			"variables sin clasificar",
		);
		assert.deepEqual(
			[...editable].filter((k) => boot.has(k)),
			[],
		);
		assert.deepEqual(
			[...editable, ...boot].filter((k) => !all.has(k)),
			[],
		);
	});

	it("lo que arranca el proceso, ejecuta código o lanza órdenes no es editable desde el panel", () => {
		for (const key of [
			"FCC_DB",
			"FIGMA_CDP_PORT",
			"FCC_DASHBOARD_PORT",
			"FIGMA_CHROME_PROFILE",
			"FCC_SCRIPTS_ROOT",
			"FCC_AGENT_TERMINAL",
			"FCC_OUTPUT_DIR",
		]) {
			assert.ok((BOOT_KEYS as readonly string[]).includes(key), key);
		}
	});
});

describe("ajustes del panel: precedencia default < base < entorno", () => {
	const KEY = "FCC_HISTORY_MAX_ROWS";

	it("sin ajuste guardado ni entorno, manda el valor por defecto", () => {
		assert.equal(parseLayered(VALID, ORIGIN).machine.history.maxRows, 200);
	});

	it("un ajuste guardado cambia el valor efectivo", () => {
		const layered = parseLayered(VALID, ORIGIN, { [KEY]: "77" });
		assert.equal(layered.machine.history.maxRows, 77);
	});

	it("el entorno sobrescribe al ajuste guardado", () => {
		const layered = parseLayered({ ...VALID, [KEY]: "33" }, ORIGIN, {
			[KEY]: "77",
		});
		assert.equal(layered.machine.history.maxRows, 33);
	});

	it("un ajuste guardado de una clave desconocida, de arranque o con un valor inválido se ignora y se cuenta, sin tumbar la configuración", () => {
		const layered = parseLayered(VALID, ORIGIN, {
			FCC_NO_EXISTE: "1",
			FIGMA_CDP_PORT: "1234",
			FCC_LIVE_POLL_MS: "abc",
			[KEY]: "77",
		});
		assert.equal(layered.machine.cdp.port, 9222);
		assert.equal(layered.machine.live.pollMs, 500);
		assert.equal(layered.machine.history.maxRows, 77);
		assert.equal(layered.settingProblems.length, 3);
		for (const key of ["FCC_NO_EXISTE", "FIGMA_CDP_PORT", "FCC_LIVE_POLL_MS"]) {
			assert.ok(
				layered.settingProblems.some((p) => p.includes(key)),
				key,
			);
		}
	});
});

describe("validateSetting: lo que se puede guardar", () => {
	it("un valor válido de una clave editable se acepta", () => {
		assert.equal(validateSetting("FCC_HISTORY_MAX_ROWS", "50"), null);
		assert.equal(validateSetting("FCC_SOFT_DEADLINE_MS", "15000"), null);
	});

	it("una clave desconocida, una de arranque y un valor inválido se rechazan con el motivo", () => {
		assert.match(validateSetting("FCC_NO_EXISTE", "1") ?? "", /desconocid/i);
		assert.match(validateSetting("FCC_DB", "/x.db") ?? "", /arranque/i);
		assert.match(validateSetting("FIGMA_CDP_PORT", "1234") ?? "", /arranque/i);
		for (const bad of ["0", "-3", "abc", "", "1.5"]) {
			assert.notEqual(
				validateSetting("FCC_HISTORY_MAX_ROWS", bad),
				null,
				JSON.stringify(bad),
			);
		}
	});
});

describe("validateSetting: el motivo se lee en castellano, sin repetir la clave", () => {
	const reason = (key: string, value: string): string =>
		validateSetting(key, value) ?? "";

	it("por debajo del mínimo, no es un número y no es entero dicen qué se espera", () => {
		assert.equal(
			reason("FCC_BUILD_MAX_STEPS", "-5"),
			"Tiene que ser un número entero mayor que 0.",
		);
		assert.equal(
			reason("FCC_BUILD_MAX_STEPS", "0"),
			"Tiene que ser un número entero mayor que 0.",
		);
		assert.equal(
			reason("FCC_BUILD_MAX_STEPS", "abc"),
			"Tiene que ser un número entero.",
		);
		assert.equal(
			reason("FCC_BUILD_MAX_STEPS", "1.5"),
			"Tiene que ser un número entero.",
		);
	});

	it("un mínimo que admite el cero lo dice (igual o mayor)", () => {
		assert.equal(
			reason("FCC_ACTIVITY_CODE_PREVIEW_CHARS", "-1"),
			"Tiene que ser un número entero igual o mayor que 0.",
		);
	});

	it("no sale ningún resto del inglés de zod", () => {
		for (const bad of ["-5", "abc", "1.5", ""]) {
			assert.doesNotMatch(
				reason("FCC_LIVE_POLL_MS", bad),
				/Too small|expected|Invalid|received/,
				bad,
			);
		}
	});

	it("el aviso de un valor guardado que no vale sí nombra la clave (la pantalla lo busca por ella)", () => {
		const layered = parseLayered(VALID, ORIGIN, {
			FCC_BUILD_MAX_STEPS: "-5",
		});
		assert.deepEqual(layered.settingProblems, [
			"ajuste ignorado: «FCC_BUILD_MAX_STEPS»: Tiene que ser un número entero mayor que 0.",
		]);
	});
});

describe("isSettingDefault: un valor igual al de por defecto", () => {
	it("compara el valor leído por zod con el default de la clave", () => {
		assert.equal(isSettingDefault("FCC_BUILD_MAX_STEPS", "50"), true);
		assert.equal(isSettingDefault("FCC_BUILD_MAX_STEPS", " 50 "), true);
		assert.equal(isSettingDefault("FCC_BUILD_MAX_STEPS", "51"), false);
	});
});

describe("describeSettings: valor guardado, efectivo y de dónde viene", () => {
	it("lista cada ajuste editable con su origen: default, panel o env", () => {
		const view = describeSettings(
			{ ...VALID, FCC_LIVE_POLL_MS: "250" },
			{ FCC_HISTORY_MAX_ROWS: "77", FCC_LIVE_POLL_MS: "900" },
		);
		const by = Object.fromEntries(view.map((v) => [v.key, v]));
		assert.deepEqual(
			view.map((v) => v.key),
			[...EDITABLE_KEYS],
		);
		const core = (key: string) => {
			const v = by[key];
			return (
				v && {
					key: v.key,
					stored: v.stored,
					effective: v.effective,
					origin: v.origin,
				}
			);
		};
		assert.deepEqual(core("FCC_HISTORY_MAX_ROWS"), {
			key: "FCC_HISTORY_MAX_ROWS",
			stored: "77",
			effective: 77,
			origin: "panel",
		});
		assert.deepEqual(core("FCC_LIVE_POLL_MS"), {
			key: "FCC_LIVE_POLL_MS",
			stored: "900",
			effective: 250,
			origin: "env",
		});
		assert.deepEqual(core("FCC_BUILD_MAX_STEPS"), {
			key: "FCC_BUILD_MAX_STEPS",
			stored: null,
			effective: 50,
			origin: "default",
		});
	});

	it("un ajuste guardado inválido no cuenta: el efectivo es el de siempre y el origen no es panel", () => {
		const view = describeSettings(VALID, { FCC_LIVE_POLL_MS: "abc" });
		const live = view.find((v) => v.key === "FCC_LIVE_POLL_MS");
		assert.equal(live?.effective, 500);
		assert.equal(live?.origin, "default");
		assert.equal(live?.stored, "abc");
	});
});

describe("FCC_SCRIPT_MAX_BYTES", () => {
	it("es editable, del grupo Histórico, con ficha en bytes y 2.000.000 por defecto", () => {
		assert.ok(
			(EDITABLE_KEYS as readonly string[]).includes("FCC_SCRIPT_MAX_BYTES"),
		);
		const card = (
			SETTING_INFO as Record<
				string,
				{ group: string; unit: string; name: string }
			>
		)["FCC_SCRIPT_MAX_BYTES"];
		assert.equal(card?.group, "Histórico");
		assert.equal(card?.unit, "bytes");
		assert.equal(card?.name, "Tamaño máximo de un script guardado");
		assert.equal(parseConfig(VALID, ORIGIN).history.scriptMaxBytes, 2_000_000);
	});

	it("las líneas de diff que figma_history_diff devuelve en la respuesta: 200 por defecto, editable, y positivas", () => {
		assert.equal(parseConfig(VALID, ORIGIN).history.diffInlineLines, 200);
		const c = parseConfig(
			{ ...VALID, FCC_HISTORY_DIFF_INLINE_LINES: "50" },
			ORIGIN,
		);
		assert.equal(c.history.diffInlineLines, 50);
		assert.throws(() =>
			parseConfig({ ...VALID, FCC_HISTORY_DIFF_INLINE_LINES: "0" }, ORIGIN),
		);
	});

	it("se puede cambiar por entorno y un valor que no es un entero positivo se rechaza", () => {
		const c = parseConfig({ ...VALID, FCC_SCRIPT_MAX_BYTES: "500" }, ORIGIN);
		assert.equal(c.history.scriptMaxBytes, 500);
		assert.throws(() =>
			parseConfig({ ...VALID, FCC_SCRIPT_MAX_BYTES: "0" }, ORIGIN),
		);
		assert.throws(() =>
			parseConfig({ ...VALID, FCC_SCRIPT_MAX_BYTES: "abc" }, ORIGIN),
		);
	});
});

describe("ficha de cada ajuste editable", () => {
	// Grupos y quién usa cada clave
	const GROUPS: Record<string, readonly string[]> = {
		"Chrome y Figma": ["FIGMA_CDP_CALL_TIMEOUT_MS", "FIGMA_READY_TIMEOUT_MS"],
		Panel: ["FCC_DASHBOARD_HISTORY", "FCC_LIVE_POLL_MS", "FCC_CHAT_POLL_MS"],
		Agente: [
			"FCC_AGENT_LAUNCH_TIMEOUT_MS",
			"FCC_AGENT_PANEL_GRACE_MS",
			"FCC_AGENT_WATCH_RETRY_MS",
		],
		Histórico: [
			"FCC_HISTORY_RETENTION_DAYS",
			"FCC_HISTORY_MAX_ROWS",
			"FCC_HISTORY_STEP_EXCERPT_BYTES",
			"FCC_SCRIPT_MAX_BYTES",
			"FCC_HISTORY_DIFF_INLINE_LINES",
		],
		"Scripts y lotes": [
			"FCC_SOFT_DEADLINE_MS",
			"FCC_MAX_INLINE_RESULT_BYTES",
			"FCC_ACTIVITY_CODE_PREVIEW_CHARS",
			"FCC_BUILD_MAX_STEPS",
			"FIGMA_EXPORT_MAX_NODES",
			"FIGMA_DESIGN_CONTEXT_MAX_NODES",
			"FCC_BUILD_STEP_TIMEOUT_MS",
			"FCC_PROGRESS_MIN_INTERVAL_MS",
			"FCC_MAX_PARAMS_BYTES",
			"FCC_MAX_ASSET_BYTES",
		],
		"Captura de la web": [
			"FCC_WEB_PAGE_TIMEOUT_MS",
			"FCC_CAPTURE_MAX_BYTES",
			"FCC_CONTRACT_INLINE_ERRORS",
		],
	};
	const PANEL_ONLY = [
		"FCC_DASHBOARD_HISTORY",
		"FCC_LIVE_POLL_MS",
		"FCC_AGENT_LAUNCH_TIMEOUT_MS",
	];
	const BOTH = [
		"FCC_HISTORY_RETENTION_DAYS",
		"FCC_HISTORY_MAX_ROWS",
		"FCC_HISTORY_STEP_EXCERPT_BYTES",
		"FCC_SCRIPT_MAX_BYTES",
	];
	const info = SETTING_INFO as Readonly<
		Record<string, (typeof SETTING_INFO)[keyof typeof SETTING_INFO]>
	>;

	it("toda clave editable tiene ficha completa: grupo, nombre, ayuda, unidad y quién la usa", () => {
		for (const key of EDITABLE_KEYS) {
			const card = info[key];
			assert.ok(card, `${key} sin ficha`);
			for (const field of ["group", "name", "help", "unit"] as const) {
				assert.ok(card[field].trim() !== "", `${key}: ${field} vacío`);
			}
			assert.ok(card.usedBy.length > 0, `${key}: nadie la usa`);
		}
	});

	it("ninguna clave de arranque tiene ficha de editable", () => {
		assert.deepEqual(
			BOOT_KEYS.filter((k) => info[k] !== undefined),
			[],
		);
		assert.deepEqual(
			Object.keys(info).filter(
				(k) => !(EDITABLE_KEYS as readonly string[]).includes(k),
			),
			[],
		);
	});

	it("cada clave va en su grupo", () => {
		const groups: Record<string, string[]> = {};
		for (const key of EDITABLE_KEYS) {
			const group = info[key]?.group ?? "";
			groups[group] = [...(groups[group] ?? []), key];
		}
		assert.deepEqual(
			Object.fromEntries(
				Object.entries(groups).map(([g, keys]) => [g, [...keys].sort()]),
			),
			Object.fromEntries(
				Object.entries(GROUPS).map(([g, keys]) => [g, [...keys].sort()]),
			),
		);
	});

	it("quién usa cada clave es lo comprobado en el código: FCC_CHAT_POLL_MS la usa el agente", () => {
		for (const key of EDITABLE_KEYS) {
			const expected = PANEL_ONLY.includes(key)
				? ["panel"]
				: BOTH.includes(key)
					? ["panel", "agent"]
					: ["agent"];
			assert.deepEqual([...(info[key]?.usedBy ?? [])], expected, key);
		}
	});
});

describe("describeSettings: valor por defecto, ficha y con qué arrancó el panel", () => {
	it("cada ajuste trae su valor por defecto y su ficha", () => {
		const view = describeSettings(VALID, {});
		const rows = view.find((v) => v.key === "FCC_HISTORY_MAX_ROWS");
		assert.equal(rows?.default, 200);
		assert.equal(rows?.group, "Histórico");
		assert.equal(rows?.name, SETTING_INFO.FCC_HISTORY_MAX_ROWS.name);
		assert.equal(rows?.help, SETTING_INFO.FCC_HISTORY_MAX_ROWS.help);
		assert.equal(rows?.unit, "filas");
		assert.deepEqual(rows?.usedBy, ["panel", "agent"]);
	});

	it("running es lo efectivo con lo guardado al arrancar: un cambio posterior no lo mueve", () => {
		const view = describeSettings(
			VALID,
			{ FCC_LIVE_POLL_MS: "900" },
			{ FCC_LIVE_POLL_MS: "300" },
		);
		const live = view.find((v) => v.key === "FCC_LIVE_POLL_MS");
		assert.equal(live?.effective, 900);
		assert.equal(live?.running, 300);
		assert.equal(live?.origin, "panel");
		assert.equal(live?.stored, "900");
	});

	it("sin lo guardado al arrancar, running es lo que fijan entorno y valor por defecto", () => {
		const view = describeSettings(
			{ ...VALID, FCC_BUILD_MAX_STEPS: "30" },
			{ FCC_LIVE_POLL_MS: "900" },
		);
		const by = Object.fromEntries(view.map((v) => [v.key, v]));
		assert.equal(by["FCC_LIVE_POLL_MS"]?.running, 500);
		assert.equal(by["FCC_BUILD_MAX_STEPS"]?.running, 30);
	});
});

describe("reglas de guardar y restablecer", () => {
	it("editableKeyProblem: una clave editable vale; una de arranque o desconocida no, con el motivo", () => {
		assert.equal(editableKeyProblem("FCC_HISTORY_MAX_ROWS"), null);
		assert.match(editableKeyProblem("FCC_DB") ?? "", /arranque/i);
		assert.match(editableKeyProblem("FCC_NO_EXISTE") ?? "", /desconocid/i);
	});

	it("normalizeSetting: se guarda el valor como lo lee zod", () => {
		assert.equal(normalizeSetting("FCC_HISTORY_MAX_ROWS", " 500 "), "500");
		assert.equal(normalizeSetting("FCC_HISTORY_MAX_ROWS", "0050"), "50");
	});

	it("setByEnvironment: la fija el entorno si trae un valor que vale (lo mismo que dice el origen «env»)", () => {
		const source = { ...VALID, FCC_LIVE_POLL_MS: "250" };
		assert.equal(setByEnvironment(source, "FCC_LIVE_POLL_MS"), true);
		assert.equal(setByEnvironment(source, "FCC_HISTORY_MAX_ROWS"), false);
		const origin = describeSettings(source, {}).find(
			(v) => v.key === "FCC_LIVE_POLL_MS",
		)?.origin;
		assert.equal(origin, "env");
	});
});

describe("captura de la web", () => {
	const web = (extra: Record<string, string> = {}) =>
		parseLayered({ ...VALID, ...extra }, ORIGIN).machine.web;

	it("los valores por defecto: google-chrome en el 9333, perfiles en el temporal del sistema, secretos en ~/.config", () => {
		assert.deepEqual(web(), {
			chromeBin: "google-chrome",
			chromePort: 9333,
			profileDir: tmpdir(),
			secretsFile: resolve(
				homedir(),
				".config/figma-control-center/secrets.json",
			),
			pageTimeoutMs: 30_000,
			captureMaxBytes: 5_000_000,
			contractInlineErrors: 10,
		});
	});

	it("el entorno los sobrescribe; las rutas se hacen absolutas", () => {
		const set = web({
			FCC_WEB_CHROME_BIN: "/opt/chromium/chrome",
			FCC_WEB_CHROME_PORT: "9444",
			FCC_WEB_CHROME_PROFILE_DIR: "~/perfiles",
			FCC_WEB_SECRETS_FILE: "/etc/secretos.json",
			FCC_WEB_PAGE_TIMEOUT_MS: "500",
			FCC_CAPTURE_MAX_BYTES: "1000",
			FCC_CONTRACT_INLINE_ERRORS: "3",
		});
		assert.deepEqual(set, {
			chromeBin: "/opt/chromium/chrome",
			chromePort: 9444,
			profileDir: resolve(homedir(), "perfiles"),
			secretsFile: "/etc/secretos.json",
			pageTimeoutMs: 500,
			captureMaxBytes: 1000,
			contractInlineErrors: 3,
		});
	});

	it("el puerto del Chrome de captura no puede ser el del Chrome de Figma: el error nombra las dos variables", () => {
		for (const env of [
			{ FCC_WEB_CHROME_PORT: "9222" },
			{ FCC_WEB_CHROME_PORT: "9500", FIGMA_CDP_PORT: "9500" },
		]) {
			assert.throws(
				() => parseLayered({ ...VALID, ...env }, ORIGIN),
				(e: Error) =>
					e.message.includes("FCC_WEB_CHROME_PORT") &&
					e.message.includes("FIGMA_CDP_PORT"),
				JSON.stringify(env),
			);
		}
	});

	it("las tres de uso son editables y las cuatro del Chrome y los secretos, de arranque", () => {
		for (const key of [
			"FCC_WEB_PAGE_TIMEOUT_MS",
			"FCC_CAPTURE_MAX_BYTES",
			"FCC_CONTRACT_INLINE_ERRORS",
		]) {
			assert.ok((EDITABLE_KEYS as readonly string[]).includes(key), key);
			assert.equal(
				SETTING_INFO[key as keyof typeof SETTING_INFO].group,
				"Captura de la web",
			);
			assert.deepEqual(SETTING_INFO[key as keyof typeof SETTING_INFO].usedBy, [
				"agent",
			]);
		}
		for (const key of [
			"FCC_WEB_CHROME_BIN",
			"FCC_WEB_CHROME_PORT",
			"FCC_WEB_CHROME_PROFILE_DIR",
			"FCC_WEB_SECRETS_FILE",
		]) {
			assert.ok((BOOT_KEYS as readonly string[]).includes(key), key);
		}
	});

	it("un tope o un plazo que no es entero positivo es un error que nombra la variable", () => {
		for (const key of [
			"FCC_WEB_PAGE_TIMEOUT_MS",
			"FCC_CAPTURE_MAX_BYTES",
			"FCC_CONTRACT_INLINE_ERRORS",
		]) {
			assert.throws(
				() => parseLayered({ ...VALID, [key]: "0" }, ORIGIN),
				(e: Error) => e.message.includes(key),
				key,
			);
		}
	});
});

describe("modo del panel (FCC_DASHBOARD_MODE)", () => {
	it("sin fijarlo el panel corre en producción", () => {
		assert.equal(
			parseLayered(VALID, ORIGIN).machine.dashboard.mode,
			DASHBOARD_MODE.production,
		);
	});

	it("«development» lo pone en desarrollo", () => {
		assert.equal(
			parseLayered(
				{ ...VALID, FCC_DASHBOARD_MODE: DASHBOARD_MODE.development },
				ORIGIN,
			).machine.dashboard.mode,
			DASHBOARD_MODE.development,
		);
	});

	it("un valor que no es un modo es un error que nombra la variable", () => {
		assert.throws(
			() => parseLayered({ ...VALID, FCC_DASHBOARD_MODE: "debug" }, ORIGIN),
			(e: Error) => e.message.includes("FCC_DASHBOARD_MODE"),
		);
	});

	it("es de arranque: no se cambia desde el panel", () => {
		assert.ok((BOOT_KEYS as readonly string[]).includes("FCC_DASHBOARD_MODE"));
		assert.match(editableKeyProblem("FCC_DASHBOARD_MODE") ?? "", /de arranque/);
	});
});
