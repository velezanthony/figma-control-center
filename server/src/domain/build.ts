import type { FigmaError } from "./figma-error.ts";
import type { ScriptFormat } from "./script-format.ts";
import {
	COMPOSE_KIT_STEP,
	type KitStep,
	kitStepLabel,
	SCREEN_KIT_STEP,
	SHEET_KIT_STEP,
} from "./step.ts";

// Estado de un paso del lote: aún sin empezar, en curso, o uno de los finales. El que estaba en marcha
// al cancelar acaba como `done`/`failed`; los que no llegaron a empezar quedan `cancelled`.
export const STEP_STATUS = Object.freeze({
	pending: "pending",
	running: "running",
	done: "done",
	failed: "failed",
	skipped: "skipped",
	cancelled: "cancelled",
} as const);
export type StepStatus = (typeof STEP_STATUS)[keyof typeof STEP_STATUS];

// Estado del lote entero, derivado de sus pasos (ver `buildStatusOf`).
export const BUILD_STATUS = Object.freeze({
	running: "running",
	done: "done",
	failed: "failed",
	cancelled: "cancelled",
} as const);
export type BuildStatus = (typeof BUILD_STATUS)[keyof typeof BUILD_STATUS];

// Lo que devolvió un paso: su JSON si cabe en el tope de M1 (FCC_MAX_INLINE_RESULT_BYTES) o, si no, el fichero donde
// se volcó. Un paso sin resultado (falló, no corrió, no devolvió nada) lo lleva como `null`.
export type StepResult =
	| { readonly kind: "inline"; readonly json: string }
	| { readonly kind: "file"; readonly path: string; readonly bytes: number };

// Un paso tal como se observa mientras y después de ejecutarse. `ms`/`error`/`warning`/`result` quedan en null hasta que acaba.
export type BuildStep = {
	readonly index: number;
	readonly file: string;
	readonly status: StepStatus;
	readonly ms: number | null;
	readonly touchedCount: number;
	readonly error: FigmaError | null;
	readonly warning: string | null;
	// Solo para el histórico: no viaja en la respuesta del lote
	readonly result: StepResult | null;
};

// Lo que nombra un paso del kit: los de área piden `area`; `kit/build-screen@1` pide `screen` (y puede llevar `area`, la
// variante o una captura concreta)
export type KitUse = {
	readonly step: KitStep;
	readonly area?: string | undefined;
	readonly screen?: string | undefined;
	readonly variant?: number | undefined;
	readonly capture?: string | undefined;
	// `kit/build-component@1`: la hoja de sheets@1 y si se pinta en la página aparte
	readonly sheet?: string | undefined;
	readonly scratch?: boolean | undefined;
	// `kit/compose@1`: la clave de un compose@1 de la carpeta del proyecto
	readonly compose?: string | undefined;
};

// Lo que escribe un manifiesto o una lista `steps` para un paso del kit
export type KitUseInput = {
	readonly use: KitStep;
	readonly area?: string | undefined;
	readonly screen?: string | undefined;
	readonly variant?: number | undefined;
	readonly capture?: string | undefined;
	readonly sheet?: string | undefined;
	readonly scratch?: boolean | undefined;
	readonly compose?: string | undefined;
	readonly timeoutMs?: number | undefined;
};

// El objetivo de un paso del kit (lo que sale tras su nombre en la etiqueta)
export const kitTarget = (kit: {
	readonly step: KitStep;
	readonly area?: string | undefined;
	readonly screen?: string | undefined;
	readonly sheet?: string | undefined;
	readonly compose?: string | undefined;
}): string =>
	(kit.step === SCREEN_KIT_STEP
		? kit.screen
		: kit.step === SHEET_KIT_STEP
			? kit.sheet
			: kit.step === COMPOSE_KIT_STEP
				? kit.compose
				: kit.area) ?? "";

// El paso del plan de un paso del kit escrito en un manifiesto o en `steps`
export const kitPlanStep = (
	input: KitUseInput,
	format: ScriptFormat,
): PlanStep => ({
	file: kitStepLabel(input.use, kitTarget({ ...input, step: input.use })),
	format,
	kit: {
		step: input.use,
		...(input.area !== undefined && { area: input.area }),
		...(input.screen !== undefined && { screen: input.screen }),
		...(input.variant !== undefined && { variant: input.variant }),
		...(input.capture !== undefined && { capture: input.capture }),
		...(input.sheet !== undefined && { sheet: input.sheet }),
		...(input.scratch !== undefined && { scratch: input.scratch }),
		...(input.compose !== undefined && { compose: input.compose }),
	},
	...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
});

// Un paso del plan a ejecutar (lo que pide la herramienta). Su resultado se observa luego en un `BuildStep`.
export type PlanStep = {
	// La ruta del script; en un paso del kit, su etiqueta (`kit/place@1 · Panel`): no hay fichero que leer
	readonly file: string;
	readonly format: ScriptFormat;
	// Un paso del kit: el servidor arma su código y sus params desde areas@1
	readonly kit?: KitUse | undefined;
	readonly params?: Readonly<Record<string, unknown>>;
	// nombre → ruta del asset (relativa al manifiesto o absoluta, siempre dentro de las raíces)
	readonly assets?: Readonly<Record<string, string>>;
	readonly timeoutMs?: number;
};

// El plan completo de un lote: nombre (para el panel y el histórico) y la lista ordenada de pasos.
// Los `params` del lote y de la llamada se pliegan en cada `PlanStep.params` al parsear el manifiesto (B4),
// así que aquí cada paso ya trae sus params efectivos (precedencia: paso > manifiesto > llamada).
export type BuildPlan = {
	readonly name: string;
	// Lo que el lote exige del archivo abierto antes de tocar nada; se comprueba también al reanudar con `fromStep`
	readonly expect?: { readonly fileName: string };
	readonly steps: readonly PlanStep[];
};

// Avance del lote: `done` son los pasos ejecutados en esta llamada (hechos o fallidos); los que no se ejecutaron se
// cuentan aparte (`cancelled`, `skipped`) para no esconderlos. `total` es el número de pasos del plan.
export type Progress = {
	readonly done: number;
	readonly total: number;
	readonly cancelled: number;
	readonly skipped: number;
	readonly current: { readonly index: number; readonly file: string } | null;
};

export const progressOf = (steps: readonly BuildStep[]): Progress => {
	const running = steps.find((s) => s.status === STEP_STATUS.running);
	const count = (...of: StepStatus[]) =>
		steps.filter((s) => of.includes(s.status)).length;
	return {
		done: count(STEP_STATUS.done, STEP_STATUS.failed),
		total: steps.length,
		cancelled: count(STEP_STATUS.cancelled),
		skipped: count(STEP_STATUS.skipped),
		current:
			running === undefined
				? null
				: { index: running.index, file: running.file },
	};
};

// Estado DERIVADO para el progreso en vivo: en marcha mientras quede algún paso por hacer; si todos
// terminaron, `failed` > `cancelled` > `done`. OJO: en una parada por `stopOnError` o una cancelación los
// pasos siguientes quedan `pending`, así que aquí saldría `running`. El estado TERMINAL de ese lote lo fija
// `run-build` (B5), que es quien sabe que paró; esta función no decide el cierre de un lote detenido.
export const buildStatusOf = (steps: readonly BuildStep[]): BuildStatus => {
	const active = steps.some(
		(s) => s.status === STEP_STATUS.pending || s.status === STEP_STATUS.running,
	);
	if (active) return BUILD_STATUS.running;
	if (steps.some((s) => s.status === STEP_STATUS.failed))
		return BUILD_STATUS.failed;
	if (steps.some((s) => s.status === STEP_STATUS.cancelled))
		return BUILD_STATUS.cancelled;
	return BUILD_STATUS.done;
};

// Unión de los nodos que tocó cada paso, sin repetidos y conservando el orden de aparición.
export const mergeTouched = (
	lists: readonly (readonly string[])[],
): readonly string[] => [...new Set(lists.flat())];
