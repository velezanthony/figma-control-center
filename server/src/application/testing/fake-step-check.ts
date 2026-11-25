import type { StepIssue } from "#domain/step.ts";

// El juez de step@1 de los tests del caso de uso: solo mira las dos listas de ids. El de verdad (zod) vive en
// adapters/contracts/step.ts y lo cablea compose-session.ts
export const fakeStepIssues = (value: unknown): StepIssue[] => {
	if (typeof value !== "object" || value === null) {
		return [{ pointer: "", message: "no es un objeto" }];
	}
	const record = value as Record<string, unknown>;
	const issues: StepIssue[] = [];
	for (const field of ["createdNodeIds", "mutatedNodeIds"]) {
		const list = record[field];
		if (!Array.isArray(list)) {
			issues.push({ pointer: `/${field}`, message: "falta" });
			continue;
		}
		list.forEach((id, i) => {
			if (typeof id !== "string") {
				issues.push({ pointer: `/${field}/${i}`, message: "no es texto" });
			}
		});
	}
	return issues;
};
