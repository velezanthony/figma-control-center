import type { AssetRepository } from "#application/ports/asset-repository.ts";
import type { BuildManifest } from "#application/ports/build-manifest.ts";
import type {
	ExportName,
	ReadName,
	ResultStore,
	ScreenshotName,
} from "#application/ports/result-store.ts";
import type { ScriptRepository } from "#application/ports/script-repository.ts";
import type { AssetRecord } from "#domain/attempt.ts";
import type { BuildPlan } from "#domain/build.ts";
import {
	assetReadError,
	type FigmaError,
	manifestError,
	scriptReadError,
} from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { StoredResult } from "#domain/run-outcome.ts";

export class InMemoryScriptRepository implements ScriptRepository {
	readonly files = new Map<string, string>();
	// Las rutas que se pidieron leer: un paso del kit no lee ningún fichero
	readonly reads: string[] = [];

	// Por defecto, la ruta tal cual (sin raíces que recortar)
	identity(path: string): Promise<string> {
		return Promise.resolve(path);
	}

	read(path: string): Promise<Result<string, FigmaError>> {
		this.reads.push(path);
		const code = this.files.get(path);
		return Promise.resolve(
			code === undefined ? err(scriptReadError(path, "no existe.")) : ok(code),
		);
	}
}

export class InMemoryAssetRepository implements AssetRepository {
	readonly files = new Map<string, Uint8Array>();

	describe(
		paths: Readonly<Record<string, string>>,
	): Promise<readonly AssetRecord[]> {
		const out: AssetRecord[] = [];
		for (const [name, path] of Object.entries(paths)) {
			const bytes = this.files.get(path);
			if (bytes !== undefined) {
				out.push({
					name,
					path,
					bytes: bytes.byteLength,
					sha256: `sha:${path}`,
				});
			}
		}
		return Promise.resolve(out);
	}
	readonly readCalls: Readonly<Record<string, string>>[] = [];
	readonly checkCalls: Readonly<Record<string, string>>[] = [];

	check(
		paths: Readonly<Record<string, string>>,
	): Promise<Result<void, FigmaError>> {
		this.checkCalls.push(paths);
		for (const path of Object.values(paths)) {
			if (!this.files.has(path)) {
				return Promise.resolve(err(assetReadError(path, "no existe.")));
			}
		}
		return Promise.resolve(ok(undefined));
	}

	read(
		paths: Readonly<Record<string, string>>,
	): Promise<Result<Readonly<Record<string, Uint8Array>>, FigmaError>> {
		this.readCalls.push(paths);
		const out: Record<string, Uint8Array> = {};
		for (const [name, path] of Object.entries(paths)) {
			const bytes = this.files.get(path);
			if (bytes === undefined) {
				return Promise.resolve(err(assetReadError(path, "no existe.")));
			}
			out[name] = bytes;
		}
		return Promise.resolve(ok(out));
	}
}

export class InMemoryBuildManifest implements BuildManifest {
	// Plan programado por ruta del manifiesto; el doble no pliega params (eso lo hace el adaptador real)
	readonly plans = new Map<string, BuildPlan>();
	readonly readCalls: {
		readonly path: string;
		readonly callParams?: Readonly<Record<string, unknown>>;
	}[] = [];

	read(
		path: string,
		callParams?: Readonly<Record<string, unknown>>,
	): Promise<Result<BuildPlan, FigmaError>> {
		this.readCalls.push({
			path,
			...(callParams !== undefined && { callParams }),
		});
		const plan = this.plans.get(path);
		return Promise.resolve(
			plan === undefined ? err(manifestError(path, "no existe.")) : ok(plan),
		);
	}
}

export class InMemoryResultStore implements ResultStore {
	readonly json: string[] = [];
	readonly png: Uint8Array[] = [];
	readonly pngNames: ScreenshotName[] = [];

	saveJson(json: string): Promise<StoredResult> {
		this.json.push(json);
		return Promise.resolve({
			path: `/salida/result-${this.json.length}.json`,
			bytes: new TextEncoder().encode(json).byteLength,
		});
	}

	readonly reads: { readonly json: string; readonly name: ReadName }[] = [];
	readonly exports: {
		readonly bytes: Uint8Array;
		readonly name: ExportName;
	}[] = [];
	readonly results: { readonly fileName: string; readonly json: string }[] = [];

	saveRead(json: string, name: ReadName): Promise<StoredResult> {
		this.reads.push({ json, name });
		return Promise.resolve({
			path: `/salida/reads/${name.tool}-${this.reads.length}.json`,
			bytes: new TextEncoder().encode(json).byteLength,
		});
	}

	saveExport(bytes: Uint8Array, name: ExportName): Promise<StoredResult> {
		this.exports.push({ bytes, name });
		return Promise.resolve({
			path: `/salida/exports/${name.nodeId.replaceAll(":", "-")}.${name.format.toLowerCase()}`,
			bytes: bytes.byteLength,
		});
	}

	// ruta → contenido de lo que se volcó con saveScript
	readonly scripts = new Map<string, string>();

	saveScript(
		sha256: string,
		extension: "js" | "json",
		content: string,
	): Promise<StoredResult> {
		const path = `/salida/history-scripts/${sha256}.${extension}`;
		this.scripts.set(path, content);
		return Promise.resolve({
			path,
			bytes: new TextEncoder().encode(content).byteLength,
		});
	}

	// ruta → contenido de lo que se volcó con saveDiff
	readonly diffs = new Map<string, string>();

	saveDiff(fileName: string, text: string): Promise<StoredResult> {
		const path = `/salida/history-diffs/${fileName}`;
		this.diffs.set(path, text);
		return Promise.resolve({
			path,
			bytes: new TextEncoder().encode(text).byteLength,
		});
	}

	saveResult(fileName: string, json: string): Promise<StoredResult> {
		this.results.push({ fileName, json });
		return Promise.resolve({
			path: `/salida/results/${fileName}`,
			bytes: new TextEncoder().encode(json).byteLength,
		});
	}

	savePng(png: Uint8Array, name: ScreenshotName): Promise<StoredResult> {
		this.png.push(png);
		this.pngNames.push(name);
		const { at } = name;
		const pad = (n: number) => String(n).padStart(2, "0");
		return Promise.resolve({
			path: `/salida/screenshots/${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}/${name.nodeId.replaceAll(":", "-")}_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.png`,
			bytes: png.byteLength,
		});
	}
}
