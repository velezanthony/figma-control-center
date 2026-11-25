// Contrato PROPIO step@1: el resultado de un paso. Su fuente es el esquema zod y docs/users/contracts.md, no una salida real.
// Los ejemplos se CONSTRUYEN aquí y se validan al construirlos.
import { StepResultSchema } from "#adapters/contracts/step.ts";

export const STEP_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (step@1)",
	"schemas/step.v1.json",
] as const);

export const stepExample = (): unknown =>
	StepResultSchema.parse({
		createdNodeIds: ["1:2", "1:3"],
		mutatedNodeIds: ["1:4"],
		removedNodeIds: ["1:5"],
		warnings: [
			{ code: "MULTI_MODE", message: "Colección con dos modos", nodeId: "1:4" },
			{ code: "SIN_NODO", message: "Sin nodo" },
		],
		report: { icono: "arrow", reutilizado: false },
	});
