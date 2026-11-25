// step@1: el resultado de un paso. Contrato PROPIO (docs/users/contracts.md);  JSON Schema publicado
// en schemas/step.v1.json. strictObject: una clave de más es un error. El kit repite estos tipos (no puede importar el
// servidor) y un test comprueba que lo que devuelve `kit.track().done()` cumple este esquema.
import { z } from "zod";
import type { StepIssue, StepResult } from "#domain/step.ts";

export const STEP_CONTRACT = Object.freeze({
	name: "step",
	version: 1,
} as const);

export const STEP_CONTRACT_FILE = `${STEP_CONTRACT.name}.v${STEP_CONTRACT.version}.json`;

// Un campo que falta se dice «falta»; uno de otro tipo, qué debía ser
const wrong = (expected: string) => (issue: { input?: unknown }) =>
	issue.input === undefined ? "falta" : expected;

const text = z.string({ error: wrong("no es texto") });
const ids = z.array(text, { error: wrong("no es una lista") });

const WarningSchema = z.strictObject({
	code: text.min(1, "está vacío"),
	message: text,
	nodeId: text.optional(),
});

export const StepResultSchema = z.strictObject({
	createdNodeIds: ids.describe("Ids de los nodos que el paso creó."),
	mutatedNodeIds: ids.describe("Ids de los nodos que el paso modificó."),
	removedNodeIds: ids
		.optional()
		.describe("Ids de los nodos que ya no existen: no se piden en capturas."),
	warnings: z
		.array(WarningSchema, { error: "no es una lista" })
		.optional()
		.describe("Avisos del paso: se suman al aviso de la respuesta."),
	report: z
		.record(z.string(), z.unknown(), { error: "no es un objeto" })
		.optional()
		.describe("Datos libres del paso: van al histórico, no a la respuesta."),
}) satisfies z.ZodType<StepResult>; // el tipo del dominio y el esquema no pueden divergir

// RFC 6901: «~» y «/» dentro de una clave se escapan
const pointerOf = (path: readonly PropertyKey[]): string =>
	path
		.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`)
		.join("");

// Los problemas de un resultado con el puntero JSON de cada uno (vacío = cumple el contrato)
export function stepResultIssues(value: unknown): StepIssue[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [{ pointer: "", message: "no es un objeto" }];
	}
	const parsed = StepResultSchema.safeParse(value);
	if (parsed.success) return [];
	return parsed.error.issues.map((issue) => {
		if (issue.code === "unrecognized_keys") {
			return {
				pointer: pointerOf(issue.path),
				message: `clave no admitida: ${issue.keys.join(", ")}`,
			};
		}
		return { pointer: pointerOf(issue.path), message: issue.message };
	});
}
