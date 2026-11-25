// El plan de una hoja de componente: lo arma el servidor desde la última captura válida de
// la pantalla de la hoja, sheets@1 y map@1, sin tocar Figma. Puro salvo los puertos: lee la captura del almacén y deja el
// plan en sheet-plans/. El kit solo lo pinta.
import { createHash } from "node:crypto";
import type { ScreenCapture } from "#domain/capture.ts";
import {
	COMPONENT_CONTRACT,
	type ComponentPlan,
	SHEET_SCRATCH_PAGE_PREFIX,
	SHEET_WARNING,
	type SheetPlanWarning,
	sheetKey,
	sheetPageKey,
	sheetScratchKey,
} from "#domain/component-plan.ts";
import { type FigmaError, projectConfigError } from "#domain/figma-error.ts";
import { matrixOf } from "#domain/sheet-matrix.ts";
import { sheetsWarnings } from "#domain/sheets-check.ts";
import { collectPlanAssets } from "./plan-assets.ts";
import type { LoadedProject } from "./ports/project-config.ts";
import type { WebCaptureStore } from "./ports/web-capture-store.ts";

export type SheetPlanInput = {
	readonly sheet: string;
	// Pinta en la página aparte `fcc · hoja · <clave>` en vez de la de la hoja
	readonly scratch?: boolean | undefined;
	// Ruta relativa a web-captures/ para pintar una captura concreta en vez de la última
	readonly capture?: string | undefined;
};

// Lo que recibe el kit como `params` (pequeño: el plan y las imágenes van como assets)
export type SheetStepParams = {
	readonly sheet: string;
	readonly scratch: boolean;
};

export type SheetPlanRun = {
	readonly plan: ComponentPlan;
	readonly planPath: string;
	readonly params: SheetStepParams;
	// `plan` y una entrada por imagen (su sha256) → ruta real
	readonly assets: Readonly<Record<string, string>>;
	// El módulo recognize@1 que va dentro del código del paso (como texto); null si el proyecto no lo declara
	readonly recognizeSource: string | null;
	// Lo que el historial de intentos guarda de este paso
	readonly contents: {
		readonly plan: string;
		readonly map: { readonly path: string; readonly content: string };
		readonly sheets: { readonly path: string; readonly content: string };
		readonly recognize?: { readonly path: string; readonly content: string };
	};
};

export type SheetPlanOutcome =
	| { readonly kind: "ok"; readonly run: SheetPlanRun }
	| { readonly kind: "usage"; readonly message: string }
	| { readonly kind: "error"; readonly error: FigmaError };

export type SheetPlanDeps = {
	readonly store: WebCaptureStore;
	readonly clock: () => Date;
	// El esquema de capture@1 (lo cablea la raíz: la aplicación no importa zod); problemas con su puntero
	readonly checkCapture: (
		value: unknown,
	) => readonly { readonly pointer: string; readonly message: string }[];
};

const PLAN_ASSET = "plan";

const fail = (message: string): SheetPlanOutcome => ({
	kind: "usage",
	message,
});

export type SheetPlanMaker = ReturnType<typeof makeSheetPlan>;

export function makeSheetPlan(deps: SheetPlanDeps) {
	return async (
		project: LoadedProject,
		input: SheetPlanInput,
	): Promise<SheetPlanOutcome> => {
		const { map, mapSource, sheets, sheetsSource, recognize } = project;
		if (sheets === null || sheetsSource === null) {
			return {
				kind: "error",
				error: projectConfigError(
					project.file,
					"sheets",
					"el proyecto no declara `sheets`: añade la ruta de su sheets@1 a figma-control-center.json",
				),
			};
		}
		if (map === null || mapSource === null) {
			return {
				kind: "error",
				error: projectConfigError(
					project.file,
					"map",
					"el proyecto no declara `map`: añade la ruta de su map@1 a figma-control-center.json",
				),
			};
		}
		const sheetIndex = sheets.sheets.findIndex((s) => s.key === input.sheet);
		const sheet = sheets.sheets[sheetIndex];
		if (sheet === undefined) {
			return fail(
				`la hoja «${input.sheet}» no está en sheets@1 (hojas: ${sheets.sheets.map((s) => s.key).join(", ")}).`,
			);
		}

		const stored =
			input.capture === undefined
				? await deps.store.latest(sheet.screen)
				: await deps.store.read(input.capture);
		if (stored === null) {
			return fail(
				input.capture === undefined
					? `la pantalla «${sheet.screen}» de la hoja «${sheet.key}» no tiene captura de la web: captúrala con \`figma_capture\`.`
					: `la captura «${input.capture}» no existe en web-captures/ (ruta relativa a esa carpeta, de una captura válida).`,
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(stored.json);
		} catch {
			return fail(`la captura ${stored.relative} no es JSON.`);
		}
		const problems = deps.checkCapture(parsed);
		if (problems.length > 0) {
			const first = problems[0];
			return fail(
				`la captura ${stored.relative} ya no cumple capture@1 (${first?.pointer ?? ""}: ${first?.message ?? ""}): captúrala otra vez con \`figma_capture\`.`,
			);
		}
		const capture = parsed as ScreenCapture;

		const variants = capture.variants.map((v) => ({
			props: v.props,
			root: v.nodes,
		}));
		const collected = collectPlanAssets(
			variants.map((v) => v.root),
			capture.images,
			deps.store,
			project.iconCatalog,
		);
		const warnings: SheetPlanWarning[] = [...collected.warnings];

		// Las huellas de los componentes hoja, todas: la del propio set compite y, si gana, el kit no instancia
		const leaf = map.components?.leaf ?? [];
		const known = new Set(sheets.sheets.map((s) => s.title));
		const fingerprints =
			map.components === undefined
				? undefined
				: Object.fromEntries(
						leaf.flatMap((name) => {
							const fp = project.fingerprints[name];
							return fp === undefined ? [] : [[name, fp] as const];
						}),
					);
		for (const name of leaf) {
			const fp = project.fingerprints[name];
			if (fp !== undefined && !known.has(fp.title)) {
				warnings.push({
					code: SHEET_WARNING.fingerprintWithoutSheet,
					message: `La huella «${name}» (${fp.title}) no es de ninguna hoja de sheets@1: ese componente no tendrá set que reconocer.`,
				});
			}
		}
		for (const issue of sheetsWarnings(sheets, {
			recognizeSource: recognize?.source ?? null,
		})) {
			if (issue.pointer.startsWith(`/sheets/${sheetIndex}/`)) {
				warnings.push({
					code: SHEET_WARNING.ruleUnnamed,
					message: issue.message,
				});
			}
		}

		const { catalog: _catalog, ...planIcons } = map.icons;
		const scratch = input.scratch === true;
		// Sin sección propia, la hoja va a la sección por defecto de sheets@1
		const section =
			sheet.page.section ??
			Object.entries(sheets.sections ?? {}).find(
				([, v]) => v.default === true,
			)?.[0];
		const plan: ComponentPlan = {
			contract: COMPONENT_CONTRACT,
			sheet,
			style: sheets.style,
			sources: {
				capture: {
					path: stored.relative,
					sha256: createHash("sha256").update(stored.json).digest("hex"),
				},
				sheets: { path: sheetsSource.path, sha256: sheetsSource.sha256 },
				map: { path: mapSource.path, sha256: mapSource.sha256 },
				...(recognize !== null && { recognize: { sha256: recognize.sha256 } }),
			},
			target: {
				page: scratch
					? {
							name: `${SHEET_SCRATCH_PAGE_PREFIX}${sheet.key}`,
							key: sheetScratchKey(sheet.key),
						}
					: {
							name: sheet.page.name,
							key: sheetPageKey(sheet.key),
							...(sheet.page.after !== undefined && {
								after: sheet.page.after,
							}),
							...(section !== undefined && { section }),
						},
				set: { name: sheet.title, key: sheetKey(sheet.key) },
			},
			variants,
			images: collected.images,
			icons: collected.icons,
			map: {
				tokens: map.tokens,
				fonts: map.fonts,
				...(map.effects !== undefined && { effects: map.effects }),
				icons: planIcons,
				layers: map.layers,
				...(map.screen !== undefined && { screen: map.screen }),
				...(map.components !== undefined && {
					components: { genericClasses: map.components.genericClasses },
				}),
			},
			...(fingerprints !== undefined && { fingerprints }),
			// Una hoja sin `rules` no prueba ninguna regla, como un META sin `nest`
			rules: sheet.rules ?? [],
			matrix: matrixOf(
				variants.map((v) => v.props),
				sheet.matrix?.rows,
			),
			warnings,
		};
		const planText = JSON.stringify(plan);
		const saved = await deps.store.saveSheetPlan(
			sheet.key,
			planText,
			deps.clock(),
		);
		return {
			kind: "ok",
			run: {
				plan,
				planPath: saved.path,
				params: { sheet: sheet.key, scratch },
				assets: { [PLAN_ASSET]: saved.path, ...collected.assets },
				recognizeSource: recognize?.source ?? null,
				contents: {
					plan: planText,
					map: { path: mapSource.path, content: mapSource.text },
					sheets: { path: sheetsSource.path, content: sheetsSource.text },
					...(recognize !== null && {
						recognize: { path: recognize.path, content: recognize.source },
					}),
				},
			},
		};
	};
}
