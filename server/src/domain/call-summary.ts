import type { ArgsSummary } from "./activity.ts";
import type { CallStatus } from "./history.ts";

export type CallSummaryInput = {
	readonly tool: string;
	readonly args: ArgsSummary;
	readonly status: CallStatus;
	readonly ms: number | null;
	readonly touchedCount: number;
	readonly errorType: string | null;
};

// Argumentos que dicen sobre qué trabajó la llamada, por orden de interés
const TARGET_ARGS = [
	"file",
	"manifest",
	"nodeId",
	"jobId",
	"collection",
] as const;

// Listas que el resumen de argumentos guarda como cuántos son y el primero (pages, nodeIds): la primera y cuántas más
const TARGET_LISTS = [
	{ count: "pageCount", first: "firstPage" },
	{ count: "nodeIdCount", first: "firstNodeId" },
	{ count: "screenCount", first: "firstScreen" },
] as const;

function targetOf(args: ArgsSummary): string | null {
	for (const key of TARGET_ARGS) {
		const value = args[key];
		if (typeof value === "string" && value !== "") return value;
	}
	for (const list of TARGET_LISTS) {
		const first = args[list.first];
		const count = args[list.count];
		if (typeof first !== "string" || typeof count !== "number") continue;
		return count > 1 ? `${first} (+${count - 1})` : first;
	}
	const length = args["codeLength"];
	return typeof length === "number" ? `código inline (${length} car.)` : null;
}

const nodes = (count: number): string =>
	`${count} ${count === 1 ? "nodo" : "nodos"}`;

// Sin redondear en ningún cálculo: solo se redondea la duración al escribirla
export function summarizeCall(input: CallSummaryInput): string {
	const target = targetOf(input.args);
	const head = target === null ? input.tool : `${input.tool} ${target}`;
	if (input.status === "running") return `${head} → en curso`;
	const took = input.ms === null ? "" : `, ${Math.round(input.ms)} ms`;
	if (input.status === "error") {
		return `${head} → error ${input.errorType ?? "desconocido"}${took}`;
	}
	return `${head} → ${input.touchedCount > 0 ? nodes(input.touchedCount) : "ok"}${took}`;
}
