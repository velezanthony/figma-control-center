import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { z } from "zod";
import {
	DEFAULT_STEP_FORMAT,
	ManifestSchema,
} from "#adapters/contracts/build-manifest.ts";
import type { BuildManifest } from "#application/ports/build-manifest.ts";
import { type BuildPlan, kitPlanStep, type PlanStep } from "#domain/build.ts";
import {
	assetReadError,
	type FigmaError,
	manifestError,
	scriptReadError,
} from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { SCRIPT_FORMAT } from "#domain/script-format.ts";
import { insideAnyRoot } from "./paths.ts";

// El manifiesto se valida EN EL BORDE con el contrato común; dentro se convierte a BuildPlan: ni zod ni esta forma viajan.

export type FsBuildManifestOptions = {
	readonly roots: readonly string[];
	// Contra qué se resuelve la RUTA DEL MANIFIESTO (sus pasos se resuelven contra la carpeta del manifiesto)
	readonly baseDir: string;
	// Tope de pasos de un lote (FCC_BUILD_MAX_STEPS)
	readonly maxSteps: number;
};

export class FsBuildManifest implements BuildManifest {
	readonly #roots: readonly string[];
	readonly #baseDir: string;
	readonly #maxSteps: number;

	constructor(options: FsBuildManifestOptions) {
		this.#roots = options.roots;
		this.#baseDir = options.baseDir;
		this.#maxSteps = options.maxSteps;
	}

	// Valida TODO antes de devolver el plan: una sola salida err y nada parcial (CA-6)
	async read(
		path: string,
		callParams?: Readonly<Record<string, unknown>>,
	): Promise<Result<BuildPlan, FigmaError>> {
		// La ruta del manifiesto también se contiene: un `../..` no puede leer un fichero fuera de las raíces
		let manifestPath: string;
		try {
			manifestPath = await realpath(resolve(this.#baseDir, path));
		} catch {
			return err(manifestError(path, "no existe."));
		}
		if (!(await insideAnyRoot(this.#roots, manifestPath))) {
			return err(
				manifestError(
					path,
					"está fuera de las raíces permitidas (FCC_SCRIPTS_ROOT).",
				),
			);
		}

		let raw: string;
		try {
			raw = await readFile(manifestPath, "utf8");
		} catch {
			return err(manifestError(path, "no existe."));
		}

		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch (e) {
			return err(
				manifestError(
					path,
					`JSON inválido: ${e instanceof Error ? e.message : ""}`,
				),
			);
		}

		const parsed = ManifestSchema.safeParse(json);
		if (!parsed.success) {
			return err(
				manifestError(
					path,
					`no cumple el esquema: ${z.prettifyError(parsed.error)}`,
				),
			);
		}

		const { name, expect, params: manifestParams, steps } = parsed.data;
		if (steps.length > this.#maxSteps) {
			return err(
				manifestError(
					path,
					`${steps.length} pasos superan el tope de ${this.#maxSteps}.`,
				),
			);
		}

		// Las rutas de los pasos son relativas a la carpeta del manifiesto
		const manifestDir = dirname(manifestPath);
		const planSteps: PlanStep[] = [];
		for (const step of steps) {
			// Un paso del kit no tiene fichero: se lanza con el código del kit y los params del área
			if ("use" in step) {
				planSteps.push(kitPlanStep(step, SCRIPT_FORMAT.body));
				continue;
			}
			const file = await this.#contain(manifestDir, step.file);
			if (!file.ok) return file;

			const assets: Record<string, string> = {};
			for (const [key, assetPath] of Object.entries(step.assets ?? {})) {
				const real = await this.#contain(manifestDir, assetPath, true);
				if (!real.ok) return real;
				assets[key] = real.value;
			}

			// Precedencia: paso > manifiesto > llamada (el que va después gana en el spread)
			const merged = { ...callParams, ...manifestParams, ...step.params };
			planSteps.push({
				file: file.value,
				format: step.format ?? DEFAULT_STEP_FORMAT,
				...(Object.keys(merged).length > 0 && { params: merged }),
				...(Object.keys(assets).length > 0 && { assets }),
				...(step.timeoutMs !== undefined && { timeoutMs: step.timeoutMs }),
			});
		}

		return ok({
			name: name ?? basename(manifestPath),
			...(expect !== undefined && { expect }),
			steps: planSteps,
		});
	}

	// Resuelve una ruta contra la carpeta del manifiesto, comprueba que existe y que cae dentro de las raíces.
	// Devuelve la ruta real (absoluta) que la repo de scripts/assets de B5 puede leer tal cual.
	async #contain(
		manifestDir: string,
		path: string,
		isAsset = false,
	): Promise<Result<string, FigmaError>> {
		const fail = isAsset ? assetReadError : scriptReadError;
		let real: string;
		try {
			real = await realpath(resolve(manifestDir, path));
		} catch {
			return err(fail(path, "no existe."));
		}
		if (!(await insideAnyRoot(this.#roots, real))) {
			return err(
				fail(path, "está fuera de las raíces permitidas (FCC_SCRIPTS_ROOT)."),
			);
		}
		if (!(await stat(real)).isFile()) {
			return err(fail(path, "no es un fichero."));
		}
		return ok(real);
	}
}
