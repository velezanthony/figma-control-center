// step@1: el paso que corre un script de Figma y, si su primera línea lo declara, el resultado
// que se juzga. Tipos puros, sin imports: el esquema zod que los valida vive en adapters/contracts/step.ts.

// El kit de Figma que el servidor instala en la pestaña (kits/figma → kits/dist/figma-kit.js)
export const FIGMA_KIT = "figma-kit@1";

export const STEP_CONTRACT = "step@1";

// Primera línea de un paso que se juzga: `// @contract step@1 · <qué hace>`
export const STEP_HEADER = "// @contract step@1";

// Los pasos que lleva el propio kit: el servidor los lanza con un código fijo, sin fichero de script
export const AREA_KIT_STEPS = [
	"kit/place@1",
	"kit/share@1",
	"kit/links@1",
	"kit/fill-image@1",
	"kit/layout-check@1",
] as const;
export type AreaKitStep = (typeof AREA_KIT_STEPS)[number];

// El que pinta una pantalla desde su plan: pide `screen`, no un área
export const SCREEN_KIT_STEP = "kit/build-screen@1";

// El que pinta una hoja de componente desde su plan: pide `sheet`, no un área
export const SHEET_KIT_STEP = "kit/build-component@1";

// El que pinta una pantalla diseñada en Figma sin web previa: pide `compose`, la clave de
// un compose@1 de la carpeta del proyecto
export const COMPOSE_KIT_STEP = "kit/compose@1";

export const KIT_STEPS = [
	...AREA_KIT_STEPS,
	SCREEN_KIT_STEP,
	SHEET_KIT_STEP,
	COMPOSE_KIT_STEP,
] as const;
export type KitStep = (typeof KIT_STEPS)[number];

export const isKitStep = (name: string): name is KitStep =>
	(KIT_STEPS as readonly string[]).includes(name);

const KIT_STEP_PIECE: Readonly<Record<KitStep, string>> = {
	"kit/place@1": "place",
	"kit/share@1": "share",
	"kit/links@1": "links",
	"kit/fill-image@1": "fillImage",
	"kit/layout-check@1": "layoutCheck",
	"kit/build-screen@1": "buildScreen",
	"kit/build-component@1": "buildComponent",
	"kit/compose@1": "compose",
};

// Cómo se llama un paso del kit en el progreso, el histórico y los intentos: el paso y su objetivo (el área; en
// `kit/build-screen@1`, la pantalla)
export const kitStepLabel = (step: KitStep, target: string): string =>
	`${step} · ${target}`;

// El código de un paso del kit, en formato `body`: su cabecera (el paso siempre se juzga) y la llamada a su pieza.
// `kit/build-screen@1` y `kit/build-component@1` llevan además el módulo recognize@1 del proyecto: su texto va tal cual tras `const recognize =`, en sus
// propias líneas (un comentario final o un `;` no rompen lo que sigue), o `null` si el proyecto no lo declara. El servidor
// nunca lo ejecuta; lo evalúa la pestaña de Figma
export const kitStepCode = (
	step: KitStep,
	options: { readonly recognize?: string | null } = {},
): string => {
	const call = `return await kit.steps.${KIT_STEP_PIECE[step]}(params, assets`;
	if (step !== SCREEN_KIT_STEP && step !== SHEET_KIT_STEP)
		return `${STEP_HEADER} · ${step}\n${call});`;
	const source = options.recognize?.trim();
	const declaration =
		source === undefined || source === ""
			? "const recognize = null;"
			: `const recognize =\n${source}\n;`;
	return `${STEP_HEADER} · ${step}\n${declaration}\n${call}, recognize);`;
};

export type StepWarning = {
	readonly code: string;
	readonly message: string;
	readonly nodeId?: string | undefined;
};

export type StepResult = {
	readonly createdNodeIds: readonly string[];
	readonly mutatedNodeIds: readonly string[];
	readonly removedNodeIds?: readonly string[] | undefined;
	readonly warnings?: readonly StepWarning[] | undefined;
	readonly report?: Readonly<Record<string, unknown>> | undefined;
};

// Un fallo del resultado: dónde (puntero JSON, RFC 6901; «» es la raíz) y qué
export type StepIssue = { readonly pointer: string; readonly message: string };

const BOM = "﻿";
const FIRST_LINE = /^[^\r\n]*/;

// La cabecera solo vale en la primera línea del código, sola o seguida de una descripción (nunca `step@10`)
export function declaresStep(code: string): boolean {
	const first = (FIRST_LINE.exec(code)?.[0] ?? "").replace(BOM, "").trimStart();
	if (!first.startsWith(STEP_HEADER)) return false;
	const next = first.charAt(STEP_HEADER.length);
	return next === "" || next === " " || next === "\t";
}
