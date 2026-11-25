import { type FigmaError, stepContractError } from "#domain/figma-error.ts";
import { extractTouchedNodeIds } from "#domain/run-outcome.ts";
import { declaresStep, type StepIssue } from "#domain/step.ts";

// El juez de step@1: devuelve los problemas del resultado con su puntero JSON (vacío = cumple). El esquema vive en
// adapters/contracts/step.ts; el caso de uso lo recibe ya cableado
export type StepChecker = (value: unknown) => readonly StepIssue[];

export type StepJudgement =
	// Sin cabecera: la regla de M2 tal cual (nada se juzga)
	| { readonly kind: "unjudged" }
	| {
			readonly kind: "ok";
			// createdNodeIds + mutatedNodeIds; removedNodeIds no entra: esos nodos ya no existen
			readonly touched: readonly string[];
			// Los warnings del paso como «código: mensaje» separados por «; »
			readonly warning: string | undefined;
	  }
	| {
			readonly kind: "violated";
			readonly error: FigmaError;
			// Los ids que sí se pueden leer del resultado
			readonly touched: readonly string[];
	  };

type Warnings = { warnings?: readonly { code: string; message: string }[] };

export function judgeStep(
	code: string,
	returned: unknown,
	check: StepChecker,
): StepJudgement {
	if (!declaresStep(code)) return { kind: "unjudged" };
	const touched = extractTouchedNodeIds(returned);
	const issues = check(returned);
	if (issues.length > 0) {
		return { kind: "violated", error: stepContractError(issues), touched };
	}
	const warnings = (returned as Warnings).warnings ?? [];
	return {
		kind: "ok",
		touched,
		warning:
			warnings.length === 0
				? undefined
				: warnings.map((w) => `${w.code}: ${w.message}`).join("; "),
	};
}
