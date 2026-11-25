// La configuración de captura de un proyecto: `figma-control-center.json` en su
// carpeta (project@1), el screens@1 al que apunta y el módulo de ganchos, que se lee COMO TEXTO (nunca se ejecuta en
// Node: lo evalúa el kit en el mundo aislado de la página). Las rutas son relativas al fichero y tienen que quedar dentro
// de la carpeta del proyecto o de una de sus raíces de scripts (realpath, la regla de paths.ts).
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { z } from "zod";
import { AreasSchema, areasSchemaIssues } from "#adapters/contracts/areas.ts";
import {
	FingerprintsSchema,
	fingerprintsSchemaIssues,
	MapSchema,
	mapSchemaIssues,
} from "#adapters/contracts/map.ts";
import { ProjectSchema } from "#adapters/contracts/project.ts";
import { ScreensSchema } from "#adapters/contracts/screens.ts";
import {
	SheetsSchema,
	sheetsSchemaIssues,
} from "#adapters/contracts/sheets.ts";
import type {
	LoadedProject,
	ProjectConfigSource,
} from "#application/ports/project-config.ts";
import type { AreasFile } from "#domain/areas.ts";
import { areasIssues } from "#domain/areas-check.ts";
import {
	PROJECT_CONFIG_FILE,
	type ProjectConfig,
	type ScreensFile,
} from "#domain/capture.ts";
import {
	areasContractError,
	type FigmaError,
	mapContractError,
	projectConfigError,
	sheetsContractError,
} from "#domain/figma-error.ts";
import type { Fingerprints, IconEntry, MapFile } from "#domain/map.ts";
import { fingerprintIssues, mapIssues } from "#domain/map-check.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { SheetsFile } from "#domain/sheets.ts";
import { sheetsIssues } from "#domain/sheets-check.ts";
import { insideAnyRoot } from "./paths.ts";

// El campo de un problema de zod, con puntos (`web.baseUrl`, `screens.0.url`); sin camino, el fichero entero
const fieldOf = (issue: z.core.$ZodIssue | undefined): string =>
	issue === undefined || issue.path.length === 0
		? "(fichero)"
		: issue.path.map(String).join(".");

export class FsProjectConfig implements ProjectConfigSource {
	readonly #projectDir: string;
	readonly #roots: readonly string[];

	constructor(options: {
		readonly projectDir: string;
		readonly scriptsRoots: readonly string[];
	}) {
		this.#projectDir = options.projectDir;
		this.#roots = [options.projectDir, ...options.scriptsRoots];
	}

	async load(): Promise<Result<LoadedProject, FigmaError>> {
		const file = join(this.#projectDir, PROJECT_CONFIG_FILE);
		const config = await this.#json(
			file,
			"(fichero)",
			ProjectSchema,
			`no existe: crea ${PROJECT_CONFIG_FILE} en la carpeta del proyecto (${this.#projectDir})`,
		);
		if (!config.ok) return config;

		const screensPath = await this.#contained(
			file,
			config.value.screens,
			"screens",
		);
		if (!screensPath.ok) return screensPath;
		const screens = await this.#json(
			screensPath.value,
			"(fichero)",
			ScreensSchema,
			"no existe",
		);
		if (!screens.ok) return screens;
		const crossed = sessionProblem(
			config.value,
			screens.value,
			screensPath.value,
		);
		if (crossed !== null) return err(crossed);

		let hooks: LoadedProject["hooks"] = null;
		if (config.value.hooks !== undefined) {
			const text = await this.#text(file, config.value.hooks, "hooks");
			if (!text.ok) return text;
			hooks = { source: text.value.source, sha256: text.value.sha256 };
		}
		// recognize@1 (F4b): código del proyecto, como texto; nunca se ejecuta en Node
		let recognize: LoadedProject["recognize"] = null;
		if (config.value.recognize !== undefined) {
			const text = await this.#text(file, config.value.recognize, "recognize");
			if (!text.ok) return text;
			recognize = text.value;
		}

		let areas: AreasFile | null = null;
		let areaAssets: Record<string, string> = {};
		if (config.value.areas !== undefined) {
			const loaded = await this.#areas(file, config.value.areas, screens.value);
			if (!loaded.ok) return loaded;
			areas = loaded.value.areas;
			areaAssets = loaded.value.assets;
		}
		let map: MapFile | null = null;
		let mapSource: LoadedProject["mapSource"] = null;
		let iconCatalog: readonly IconEntry[] = [];
		let fingerprints: Fingerprints = {};
		if (config.value.map !== undefined) {
			const loaded = await this.#map(file, config.value.map);
			if (!loaded.ok) return loaded;
			({ map, mapSource, iconCatalog, fingerprints } = loaded.value);
		}
		let sheets: SheetsFile | null = null;
		let sheetsSource: LoadedProject["sheetsSource"] = null;
		if (config.value.sheets !== undefined) {
			const loaded = await this.#sheets(
				file,
				config.value.sheets,
				screens.value,
			);
			if (!loaded.ok) return loaded;
			({ sheets, sheetsSource } = loaded.value);
		}
		// compose@1: solo la carpeta, ya resuelta; sus ficheros los lee quien los pinta
		let composeDir: string | null = null;
		if (config.value.compose !== undefined) {
			const dirPath = await this.#directory(
				file,
				config.value.compose,
				"compose",
			);
			if (!dirPath.ok) return dirPath;
			composeDir = dirPath.value;
		}
		return ok({
			file,
			config: config.value,
			screens: screens.value,
			hooks,
			recognize,
			areas,
			areaAssets,
			map,
			mapSource,
			iconCatalog,
			fingerprints,
			sheets,
			sheetsSource,
			composeDir,
		});
	}

	// Una carpeta del proyecto: ruta contenida (realpath) y que sea de verdad una carpeta
	async #directory(
		file: string,
		given: string,
		field: string,
	): Promise<Result<string, FigmaError>> {
		const path = await this.#contained(file, given, field);
		if (!path.ok) return path;
		const info = await stat(path.value);
		if (!info.isDirectory())
			return err(
				projectConfigError(
					file,
					field,
					`${path.value} tiene que ser una carpeta`,
				),
			);
		return ok(path.value);
	}

	// sheets@1: ruta contenida, JSON, esquema (ContractError con el puntero) y cruce con screens@1
	async #sheets(
		file: string,
		given: string,
		screens: ScreensFile,
	): Promise<
		Result<
			{
				sheets: SheetsFile;
				sheetsSource: { path: string; sha256: string; text: string };
			},
			FigmaError
		>
	> {
		const path = await this.#contained(file, given, "sheets");
		if (!path.ok) return path;
		let text: string;
		try {
			text = await readFile(path.value, "utf8");
		} catch {
			return err(
				projectConfigError(file, "sheets", `no se puede leer ${path.value}`),
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			return err(
				projectConfigError(
					file,
					"sheets",
					`${path.value} no es JSON (${e instanceof Error ? e.message : String(e)})`,
				),
			);
		}
		const problems = sheetsSchemaIssues(parsed);
		if (problems.length > 0)
			return err(sheetsContractError(path.value, problems));
		const sheets = SheetsSchema.parse(parsed);
		const crossed = sheetsIssues(sheets, screens);
		if (crossed.length > 0)
			return err(sheetsContractError(path.value, crossed));
		return ok({
			sheets,
			sheetsSource: {
				path: path.value,
				sha256: createHash("sha256").update(text).digest("hex"),
				text,
			},
		});
	}

	// El texto de un módulo del proyecto (ganchos, recognize@1): ruta contenida, legible y no vacío, con su sha256
	async #text(
		file: string,
		given: string,
		field: string,
	): Promise<
		Result<{ path: string; source: string; sha256: string }, FigmaError>
	> {
		const path = await this.#contained(file, given, field);
		if (!path.ok) return path;
		let source: string;
		try {
			source = await readFile(path.value, "utf8");
		} catch {
			return err(
				projectConfigError(file, field, `no se puede leer ${path.value}`),
			);
		}
		if (source.trim() === "")
			return err(projectConfigError(file, field, `${path.value} está vacío`));
		return ok({
			path: path.value,
			source,
			sha256: createHash("sha256").update(source).digest("hex"),
		});
	}

	// areas@1: ruta contenida, JSON, esquema (ContractError con el puntero), cruce con screens@1 y las imágenes de relleno
	async #areas(
		file: string,
		given: string,
		screens: ScreensFile,
	): Promise<
		Result<{ areas: AreasFile; assets: Record<string, string> }, FigmaError>
	> {
		const areasPath = await this.#contained(file, given, "areas");
		if (!areasPath.ok) return areasPath;
		let text: string;
		try {
			text = await readFile(areasPath.value, "utf8");
		} catch {
			return err(
				projectConfigError(
					file,
					"areas",
					`no se puede leer ${areasPath.value}`,
				),
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			return err(
				projectConfigError(
					file,
					"areas",
					`${areasPath.value} no es JSON (${e instanceof Error ? e.message : String(e)})`,
				),
			);
		}
		const problems = areasSchemaIssues(parsed);
		if (problems.length > 0)
			return err(areasContractError(areasPath.value, problems));
		const areas = AreasSchema.parse(parsed);
		const crossed = areasIssues(
			areas,
			screens.screens.map((s) => s.key),
		);
		if (crossed.length > 0)
			return err(areasContractError(areasPath.value, crossed));

		const assets: Record<string, string> = {};
		for (const area of areas.areas) {
			for (const fill of area.fills ?? []) {
				if (assets[fill.asset] !== undefined) continue;
				const real = await this.#contained(
					areasPath.value,
					fill.asset,
					"areas",
				);
				if (!real.ok) return real;
				assets[fill.asset] = real.value;
			}
		}
		return ok({ areas, assets });
	}

	// map@1: ruta contenida, JSON, esquema y expresiones (ContractError con el puntero) y el catálogo de iconos
	async #map(
		file: string,
		given: string,
	): Promise<
		Result<
			{
				map: MapFile;
				mapSource: { path: string; sha256: string; text: string };
				iconCatalog: readonly IconEntry[];
				fingerprints: Fingerprints;
			},
			FigmaError
		>
	> {
		const mapPath = await this.#contained(file, given, "map");
		if (!mapPath.ok) return mapPath;
		let text: string;
		try {
			text = await readFile(mapPath.value, "utf8");
		} catch {
			return err(
				projectConfigError(file, "map", `no se puede leer ${mapPath.value}`),
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			return err(
				projectConfigError(
					file,
					"map",
					`${mapPath.value} no es JSON (${e instanceof Error ? e.message : String(e)})`,
				),
			);
		}
		const problems = mapSchemaIssues(parsed);
		if (problems.length > 0)
			return err(mapContractError(mapPath.value, problems));
		const map = MapSchema.parse(parsed);
		const checks = mapIssues(map);
		if (checks.length > 0) return err(mapContractError(mapPath.value, checks));

		const field = "map.icons.catalog";
		const catalogPath = await this.#contained(
			mapPath.value,
			map.icons.catalog,
			field,
		);
		if (!catalogPath.ok) return catalogPath;
		let catalogText: string;
		try {
			catalogText = await readFile(catalogPath.value, "utf8");
		} catch {
			return err(
				projectConfigError(
					file,
					field,
					`no se puede leer ${catalogPath.value}`,
				),
			);
		}
		let catalog: unknown;
		try {
			catalog = JSON.parse(catalogText);
		} catch {
			return err(
				projectConfigError(file, field, `${catalogPath.value} no es JSON`),
			);
		}
		if (!isIconCatalog(catalog))
			return err(
				projectConfigError(
					file,
					field,
					`${catalogPath.value} tiene que ser una lista de { name, svg }`,
				),
			);
		let fingerprints: Fingerprints = {};
		if (map.components !== undefined) {
			const loaded = await this.#fingerprints(
				file,
				mapPath.value,
				map.components.fingerprints,
			);
			if (!loaded.ok) return loaded;
			fingerprints = loaded.value;
			const crossed = fingerprintIssues(map, fingerprints);
			if (crossed.length > 0)
				return err(mapContractError(mapPath.value, crossed));
		}
		return ok({
			map,
			mapSource: {
				path: mapPath.value,
				sha256: createHash("sha256").update(text).digest("hex"),
				text,
			},
			iconCatalog: catalog,
			fingerprints,
		});
	}

	// Las huellas de componentes a las que apunta map@1.components (JSON { <componente>: huella })
	async #fingerprints(
		file: string,
		mapPath: string,
		given: string,
	): Promise<Result<Fingerprints, FigmaError>> {
		const field = "map.components.fingerprints";
		const path = await this.#contained(mapPath, given, field);
		if (!path.ok) return path;
		let text: string;
		try {
			text = await readFile(path.value, "utf8");
		} catch {
			return err(
				projectConfigError(file, field, `no se puede leer ${path.value}`),
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return err(projectConfigError(file, field, `${path.value} no es JSON`));
		}
		const problems = fingerprintsSchemaIssues(parsed);
		if (problems.length > 0) {
			const first = problems[0];
			return err(
				projectConfigError(
					file,
					field,
					`${path.value} no cumple (${first?.pointer ?? ""}: ${first?.message ?? ""})`,
				),
			);
		}
		return ok(FingerprintsSchema.parse(parsed) as Fingerprints);
	}

	// Una ruta del fichero, ya resuelta (realpath) y dentro de la carpeta del proyecto o de una raíz de scripts
	async #contained(
		file: string,
		given: string,
		field: string,
	): Promise<Result<string, FigmaError>> {
		let real: string;
		try {
			real = await realpath(resolve(dirname(file), given));
		} catch {
			return err(projectConfigError(file, field, `«${given}» no existe`));
		}
		if (!(await insideAnyRoot(this.#roots, real)))
			return err(
				projectConfigError(
					file,
					field,
					`«${given}» queda fuera de la carpeta del proyecto y de sus raíces de scripts`,
				),
			);
		return ok(real);
	}

	async #json<T>(
		path: string,
		field: string,
		schema: z.ZodType<T>,
		missing: string,
	): Promise<Result<T, FigmaError>> {
		let text: string;
		try {
			text = await readFile(path, "utf8");
		} catch {
			return err(projectConfigError(path, field, missing));
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			return err(
				projectConfigError(
					path,
					field,
					`no es JSON (${e instanceof Error ? e.message : String(e)})`,
				),
			);
		}
		const result = schema.safeParse(parsed);
		if (!result.success) {
			const issue = result.error.issues[0];
			return err(
				projectConfigError(
					path,
					fieldOf(issue),
					issue?.message ?? "no cumple el contrato",
				),
			);
		}
		return ok(result.data);
	}
}

const isIconCatalog = (value: unknown): value is IconEntry[] =>
	Array.isArray(value) &&
	value.every(
		(e) =>
			typeof e === "object" &&
			e !== null &&
			typeof (e as IconEntry).name === "string" &&
			typeof (e as IconEntry).svg === "string",
	);

// Una `session` que nombra un usuario que no está en web.users
function sessionProblem(
	config: ProjectConfig,
	screens: ScreensFile,
	screensFile: string,
): FigmaError | null {
	const users = config.web.users ?? {};
	for (const [i, s] of screens.screens.entries()) {
		if (s.session !== undefined && users[s.session] === undefined)
			return projectConfigError(
				screensFile,
				`screens.${i}.session`,
				`el usuario «${s.session}» no está en web.users de ${PROJECT_CONFIG_FILE}`,
			);
	}
	return null;
}
