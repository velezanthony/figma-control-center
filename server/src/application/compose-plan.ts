// El plan de un compose@1: lo arma el servidor desde el fichero del compose, sheets@1
// y el catálogo del archivo abierto, y lo valida ANTES de que ningún paso toque Figma. Primero lo que no necesita Figma
// (valores sueltos, hojas que no existen: sin ninguna lectura); después variantes, props y tokens contra el catálogo, con
// tres lecturas y ningún paso que escriba. El kit solo pinta lo que ya cumple.
import { STYLE_KIND } from "#domain/catalog.ts";
import type { ComposeFile } from "#domain/compose.ts";
import {
	type CatalogSet,
	type CatalogVariable,
	type ComposeCatalog,
	composeCatalogIssues,
	composeOfflineIssues,
	composeSheetsUsed,
} from "#domain/compose-check.ts";
import {
	composeContractError,
	type FigmaError,
	projectConfigError,
} from "#domain/figma-error.ts";
import type { ComposeStore } from "./ports/compose-store.ts";
import type { FigmaReader } from "./ports/figma-reader.ts";
import type { LoadedProject } from "./ports/project-config.ts";

export type ComposePlanInput = {
	// La clave del compose: el fichero `<clave>.json` de la carpeta `compose` del proyecto
	readonly compose: string;
};

// Lo que recibe el kit como `params`: el compose y, de las hojas que usa, su clave y el título con el que se busca su set
export type ComposeStepParams = {
	readonly compose: ComposeFile;
	readonly sheets: readonly { readonly key: string; readonly title: string }[];
};

export type ComposePlanRun = {
	readonly params: ComposeStepParams;
	// Lo que el historial de intentos guarda de este paso
	readonly contents: {
		readonly plan: string;
		readonly sheets?: { readonly path: string; readonly content: string };
	};
};

export type ComposePlanOutcome =
	| { readonly kind: "ok"; readonly run: ComposePlanRun }
	| { readonly kind: "usage"; readonly message: string }
	| { readonly kind: "error"; readonly error: FigmaError };

export type ComposePlanDeps = {
	readonly reader: FigmaReader;
	readonly composes: ComposeStore;
};

export type ComposePlanMaker = ReturnType<typeof makeComposePlan>;

export function makeComposePlan(deps: ComposePlanDeps) {
	return async (
		project: LoadedProject,
		input: ComposePlanInput,
	): Promise<ComposePlanOutcome> => {
		if (project.composeDir === null) {
			return {
				kind: "error",
				error: projectConfigError(
					project.file,
					"compose",
					"el proyecto no declara `compose`: añade la carpeta de sus compose@1 a figma-control-center.json",
				),
			};
		}
		const read = await deps.composes.read(project.composeDir, input.compose);
		if (read.kind === "usage") return { kind: "usage", message: read.message };
		if (read.kind === "error") return { kind: "error", error: read.error };
		if (read.kind === "missing") {
			return {
				kind: "usage",
				message: `el compose «${input.compose}» no existe: crea ${read.path} (contrato compose@1).`,
			};
		}
		const { compose, path } = read;
		const sheets = (project.sheets?.sheets ?? []).map((s) => ({
			key: s.key,
			title: s.title,
		}));

		const offline = composeOfflineIssues(compose, sheets);
		if (offline.length > 0) {
			return { kind: "error", error: composeContractError(path, offline) };
		}

		const catalog = await readCatalog(deps.reader);
		if (!("sets" in catalog)) return { kind: "error", error: catalog };
		const issues = composeCatalogIssues(compose, sheets, catalog);
		if (issues.length > 0) {
			return { kind: "error", error: composeContractError(path, issues) };
		}

		const used = composeSheetsUsed(compose);
		return {
			kind: "ok",
			run: {
				params: {
					compose,
					sheets: sheets.filter((s) => used.includes(s.key)),
				},
				contents: {
					plan: read.text,
					...(project.sheetsSource !== null && {
						sheets: {
							path: project.sheetsSource.path,
							content: project.sheetsSource.text,
						},
					}),
				},
			},
		};
	};
}

// El catálogo del archivo abierto: sets, variables y estilos de texto. Una lectura nueva cada vez (nada de caché: lo que se
// valida es lo que hay ahora)
async function readCatalog(
	reader: FigmaReader,
): Promise<ComposeCatalog | FigmaError> {
	const ready = await reader.ready();
	if (!ready.ok) return ready.error;
	const components = await reader.components({ page: null, query: null });
	if (!components.ok) return components.error;
	const variables = await reader.variables({ collection: null, nodeId: null });
	if (!variables.ok) return variables.error;
	const styles = await reader.styles(STYLE_KIND.text);
	if (!styles.ok) return styles.error;
	return {
		sets: components.value.map(
			(c): CatalogSet => ({
				name: c.name,
				variants: c.variants,
				properties: c.properties.map((p) => ({ name: p.name, type: p.type })),
			}),
		),
		variables: variables.value.collections.flatMap((collection) =>
			collection.variables.map(
				(v): CatalogVariable => ({
					name: v.name,
					collection: collection.name,
					type: v.resolvedType,
				}),
			),
		),
		textStyles: styles.value.map((s) => s.name),
	};
}
