import type {
	BuildStepFullResult,
	BuildStepItem,
	BuildStepStatus,
	CallItem,
} from "#web/lib/contract.ts";
import { STEP_STATUS_TERM } from "#web/lib/glossary/terms.ts";

// Avance de un lote derivado de sus pasos (espejo de domain/build.ts progressOf, aquí sobre BuildStepItem; lo ata
// server/test/web-build-progress.test.ts): ejecutados (hechos o fallidos), total, cancelados, omitidos y el paso
// en curso (o null). La página Jobs lo refresca en vivo por el SSE.
export type BuildProgress = {
	readonly done: number;
	readonly total: number;
	readonly cancelled: number;
	readonly skipped: number;
	readonly current: { readonly index: number; readonly file: string } | null;
};

export function buildProgress(steps: readonly BuildStepItem[]): BuildProgress {
	const running = steps.find((s) => s.status === "running");
	const count = (...of: BuildStepStatus[]) =>
		steps.filter((s) => of.includes(s.status)).length;
	return {
		done: count("done", "failed"),
		total: steps.length,
		cancelled: count("cancelled"),
		skipped: count("skipped"),
		current:
			running === undefined
				? null
				: { index: running.index, file: running.file },
	};
}

// Tono de la barra: rojo solo si algún paso falló; un lote cancelado no es un fallo
export const progressTone = (
	steps: readonly BuildStepItem[],
): "brand" | "danger" =>
	steps.some((s) => s.status === "failed") ? "danger" : "brand";

// Variantes del átomo Badge; cancelado/omitido/pendiente son neutros (no son un fallo)
type BadgeVariant =
	| "primary"
	| "secondary"
	| "success"
	| "danger"
	| "warning"
	| "info";

export type StepBadge = {
	readonly variant: BadgeVariant;
	readonly text: string;
	// Clave del glosario que explica el estado (tooltip con foco)
	readonly term: string;
};

const STEP_BADGE: Record<BuildStepStatus, StepBadge> = {
	pending: {
		variant: "secondary",
		text: "Pendiente",
		term: STEP_STATUS_TERM.pending,
	},
	running: {
		variant: "warning",
		text: "En curso",
		term: STEP_STATUS_TERM.running,
	},
	done: { variant: "success", text: "Hecho", term: STEP_STATUS_TERM.done },
	failed: { variant: "danger", text: "Fallo", term: STEP_STATUS_TERM.failed },
	skipped: {
		variant: "secondary",
		text: "Omitido",
		term: STEP_STATUS_TERM.skipped,
	},
	cancelled: {
		variant: "secondary",
		text: "Cancelado",
		term: STEP_STATUS_TERM.cancelled,
	},
};

export const stepBadge = (status: BuildStepStatus): StepBadge =>
	STEP_BADGE[status];

// Nombre de la herramienta de lote (no se importa de domain/tool-names.ts: la web solo toca los contratos)
const BUILD_TOOL = "figma_build";

export const isBuildCall = (entry: CallItem): boolean =>
	entry.tool === BUILD_TOOL;

export const isCancelledBuild = (entry: CallItem): boolean =>
	entry.job?.status === "cancelled";

// Cuánto del JSON de un resultado se enseña en el panel; el resto está en el histórico (figma_history_call)
export const RESULT_PREVIEW_CHARS = 2000;

const NO_RESULT_TEXT = "Sin resultado guardado";
const RESULT_INDENT = 2;

export type StepResultView =
	| { readonly kind: "hidden" }
	| { readonly kind: "none"; readonly text: string }
	// El extracto que trae el histórico (JSON compacto cortado); `truncated` dice si falta el resto
	| {
			readonly kind: "excerpt";
			readonly text: string;
			readonly bytes: number;
			readonly truncated: boolean;
	  }
	// El resultado entero ya pedido, legible y recortado a la vista previa
	| {
			readonly kind: "text";
			readonly text: string;
			readonly hiddenChars: number;
	  }
	| { readonly kind: "file"; readonly path: string; readonly bytes: number };

// Qué enseña un paso de su resultado: nada mientras no acabó (o si falló: lo que cuenta es su error); y, en los
// que acabaron sin resultado (lotes anteriores a guardarlo, pasos omitidos o cancelados), que no hay.
// Sin `full` enseña el extracto del histórico; con el resultado entero ya pedido, ese (legible, recortado a la vista previa).
export function stepResultView(
	step: BuildStepItem,
	full?: BuildStepFullResult | null,
): StepResultView {
	const { result, status } = step;
	if (full?.kind === "inline") {
		const text = JSON.stringify(full.value, null, RESULT_INDENT);
		return {
			kind: "text",
			text: text.slice(0, RESULT_PREVIEW_CHARS),
			hiddenChars: Math.max(0, text.length - RESULT_PREVIEW_CHARS),
		};
	}
	if (result?.kind === "file") {
		return { kind: "file", path: result.path, bytes: result.bytes };
	}
	if (result?.kind === "inline") {
		return {
			kind: "excerpt",
			text: result.excerpt,
			bytes: result.bytes,
			truncated: result.truncated,
		};
	}
	return status === "done" || status === "skipped" || status === "cancelled"
		? { kind: "none", text: NO_RESULT_TEXT }
		: { kind: "hidden" };
}
