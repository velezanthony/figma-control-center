// El plan de una pantalla: lo arma el servidor desde la última captura válida y map@1, sin
// tocar Figma. Puro salvo los puertos: lee la captura del almacén y deja el plan en screen-plans/. El kit solo lo pinta.
import { createHash } from "node:crypto";
import type { Area, AreasFile } from "#domain/areas.ts";
import type { ScreenCapture } from "#domain/capture.ts";
import { type FigmaError, projectConfigError } from "#domain/figma-error.ts";
import type { MapFile } from "#domain/map.ts";
import {
	PLAN_WARNING,
	type PlanWarning,
	SCREEN_CONTRACT,
	SCREEN_PAGE_NAME_PREFIX,
	type ScreenPlan,
	screenKey,
	screenPageKey,
} from "#domain/screen-plan.ts";
import { collectPlanAssets } from "./plan-assets.ts";
import type { LoadedProject } from "./ports/project-config.ts";
import type { WebCaptureStore } from "./ports/web-capture-store.ts";

export type ScreenPlanInput = {
	readonly screen: string;
	readonly area?: string | undefined;
	readonly frame?: string | undefined;
	readonly variant?: number | undefined;
	// Ruta relativa a web-captures/ para pintar una captura concreta en vez de la última
	readonly capture?: string | undefined;
};

// Lo que recibe el kit como `params` (pequeño: el plan y las imágenes van como assets)
export type ScreenStepParams = {
	readonly screen: string;
	readonly area?: string | undefined;
	readonly frame?: string | undefined;
	readonly variant: number;
};

export type ScreenPlanRun = {
	readonly plan: ScreenPlan;
	readonly planPath: string;
	readonly params: ScreenStepParams;
	// `plan` y una entrada por imagen (su sha256) → ruta real
	readonly assets: Readonly<Record<string, string>>;
	// El módulo recognize@1 que va dentro del código del paso (como texto); null si el proyecto no lo declara
	readonly recognizeSource: string | null;
	// Lo que el historial de intentos guarda de este paso: el texto del plan, el de map.json y el de recognize.js
	readonly contents: {
		readonly plan: string;
		readonly map: { readonly path: string; readonly content: string };
		readonly recognize?: { readonly path: string; readonly content: string };
	};
};

export type ScreenPlanOutcome =
	| { readonly kind: "ok"; readonly run: ScreenPlanRun }
	| { readonly kind: "usage"; readonly message: string }
	| { readonly kind: "error"; readonly error: FigmaError };

export type ScreenPlanDeps = {
	readonly store: WebCaptureStore;
	readonly clock: () => Date;
	// El esquema de capture@1 (lo cablea la raíz: la aplicación no importa zod); problemas con su puntero
	readonly checkCapture: (
		value: unknown,
	) => readonly { readonly pointer: string; readonly message: string }[];
};

const PLAN_ASSET = "plan";

const fail = (message: string): ScreenPlanOutcome => ({
	kind: "usage",
	message,
});

// Los nombres de capa que areas@1 espera encontrar y que layers.roles no produce
function unknownLayerNames(
	map: MapFile,
	area: Area,
	areas: AreasFile,
): PlanWarning[] {
	const known = new Set(Object.values(map.layers.roles));
	const wanted: [string, readonly string[]][] = [
		[`shell.in de «${area.name}»`, area.shell?.in ?? []],
		[`main de «${area.name}»`, area.main ?? []],
		["linkRules.rows.row", areas.linkRules.rows.row],
		["linkRules.rows.body", areas.linkRules.rows.body],
	];
	return wanted.flatMap(([where, names]) =>
		names
			.filter((name) => !known.has(name))
			.map((name) => ({
				code: PLAN_WARNING.layerNameUnknown,
				message: `El nombre de capa «${name}» (${where}) no sale de layers.roles de map@1.`,
			})),
	);
}

export type ScreenPlanMaker = ReturnType<typeof makeScreenPlan>;

export function makeScreenPlan(deps: ScreenPlanDeps) {
	return async (
		project: LoadedProject,
		input: ScreenPlanInput,
	): Promise<ScreenPlanOutcome> => {
		const { map, mapSource } = project;
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
		const screen = project.screens.screens.find((s) => s.key === input.screen);
		if (screen === undefined) {
			return fail(
				`la pantalla «${input.screen}» no está en screens@1 (pantallas: ${project.screens.screens.map((s) => s.key).join(", ")}).`,
			);
		}

		let area: Area | undefined;
		let frame: string | undefined = input.frame;
		if (input.area !== undefined) {
			area = project.areas?.areas.find((a) => a.name === input.area);
			if (area === undefined) {
				return fail(
					`el área «${input.area}» no está en areas@1${project.areas === null ? " (el proyecto no declara `areas`)" : ` (áreas: ${project.areas.areas.map((a) => a.name).join(", ")})`}.`,
				);
			}
			frame ??= area.screens.find((s) => s.screen === input.screen)?.frame;
			if (frame === undefined) {
				return fail(
					`la pantalla «${input.screen}» no está en el área «${area.name}» (ningún frame de areas@1 la declara en \`screen\`).`,
				);
			}
		}

		const stored =
			input.capture === undefined
				? await deps.store.latest(input.screen)
				: await deps.store.read(input.capture);
		if (stored === null) {
			return fail(
				input.capture === undefined
					? `la pantalla «${input.screen}» no tiene captura de la web: captúrala con \`figma_capture\`.`
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

		const variant = input.variant ?? 0;
		const picked = capture.variants[variant];
		if (picked === undefined) {
			return fail(
				`la variante ${variant} no existe en la captura de «${input.screen}» (tiene ${capture.variants.length}).`,
			);
		}

		const collected = collectPlanAssets(
			[picked.nodes],
			capture.images,
			deps.store,
			project.iconCatalog,
		);
		const { images, icons, assets } = collected;
		const warnings: PlanWarning[] = [...collected.warnings];
		if (area !== undefined && project.areas !== null) {
			warnings.push(...unknownLayerNames(map, area, project.areas));
		}

		const { catalog: _catalog, ...planIcons } = map.icons;
		// F4b: las huellas solo de los componentes hoja y las reglas que la pantalla limita
		const fingerprints =
			map.components === undefined
				? undefined
				: Object.fromEntries(
						map.components.leaf.flatMap((name) => {
							const fp = project.fingerprints[name];
							return fp === undefined ? [] : [[name, fp] as const];
						}),
					);
		const rules = map.screens?.[input.screen]?.rules;
		const { recognize } = project;
		const plan: ScreenPlan = {
			contract: SCREEN_CONTRACT,
			screen: input.screen,
			title: capture.title,
			variant,
			props: picked.props,
			sources: {
				capture: {
					path: stored.relative,
					sha256: createHash("sha256").update(stored.json).digest("hex"),
				},
				map: { path: mapSource.path, sha256: mapSource.sha256 },
				...(recognize !== null && { recognize: { sha256: recognize.sha256 } }),
			},
			target:
				area === undefined || frame === undefined
					? {
							page: {
								name: `${SCREEN_PAGE_NAME_PREFIX}${input.screen}`,
								key: screenPageKey(input.screen),
							},
							frame: { name: capture.title, key: screenKey(input.screen) },
						}
					: {
							page: {
								name: `${area.place.source.pagePrefix}${frame}`,
								key: screenPageKey(input.screen),
								after: area.page,
							},
							frame: { name: frame, key: screenKey(input.screen) },
						},
			root: picked.nodes,
			images,
			icons,
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
			...(rules !== undefined && { rules }),
			warnings,
		};
		const planText = JSON.stringify(plan);
		const saved = await deps.store.savePlan(
			input.screen,
			planText,
			deps.clock(),
		);
		return {
			kind: "ok",
			run: {
				plan,
				planPath: saved.path,
				params: {
					screen: input.screen,
					...(area !== undefined && { area: area.name }),
					...(frame !== undefined && { frame }),
					variant,
				},
				assets: { [PLAN_ASSET]: saved.path, ...assets },
				recognizeSource: recognize?.source ?? null,
				contents: {
					plan: planText,
					map: { path: mapSource.path, content: mapSource.text },
					...(recognize !== null && {
						recognize: { path: recognize.path, content: recognize.source },
					}),
				},
			},
		};
	};
}
