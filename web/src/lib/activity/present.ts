import type { CallItem } from "#web/lib/contract.ts";
import { STATUS_TERM, termOf } from "#web/lib/glossary/terms.ts";

export type Tone = "running" | "ok" | "error" | "cancelled";
export type Label = {
	readonly tone: Tone;
	readonly text: string;
	// Clave del glosario que explica la etiqueta
	readonly term: string;
};

// Un tipo de error que el glosario no conoce se explica con el término genérico
const errorTerm = (type: string | undefined, fallback: string): string =>
	type !== undefined && termOf(type) !== null ? type : fallback;

export function callLabel(entry: CallItem): Label {
	if (entry.status === "running")
		return { tone: "running", text: "En curso", term: STATUS_TERM.running };
	if (entry.status === "ok")
		return { tone: "ok", text: "Correcto", term: STATUS_TERM.ok };
	return {
		tone: "error",
		text: entry.error?.type ?? "Error",
		term: errorTerm(entry.error?.type, STATUS_TERM.error),
	};
}

// Solo las llamadas que lanzaron un script largo tienen job
export function jobLabel(entry: CallItem): Label | null {
	if (entry.job === null) return null;
	if (entry.job.status === "running")
		return {
			tone: "running",
			text: "Job en curso",
			term: STATUS_TERM.jobRunning,
		};
	if (entry.job.status === "done")
		return { tone: "ok", text: "Job terminado", term: STATUS_TERM.jobDone };
	if (entry.job.status === "cancelled")
		return {
			tone: "cancelled",
			text: "Job cancelado",
			term: STATUS_TERM.jobCancelled,
		};
	return {
		tone: "error",
		text: entry.job.error?.type ?? "Job fallido",
		term: errorTerm(entry.job.error?.type, STATUS_TERM.jobFailed),
	};
}

// Argumentos que dicen sobre qué trabajó la llamada, por orden de interés
const SUMMARY_ARGS = ["file", "manifest", "nodeId", "jobId"] as const;

export function argSummary(entry: CallItem): string | null {
	for (const key of SUMMARY_ARGS) {
		const value = entry.args[key];
		if (typeof value === "string" && value !== "") return value;
	}
	const count = entry.args["stepCount"];
	if (typeof count !== "number") return null;
	const steps = `${count} ${count === 1 ? "paso" : "pasos"}`;
	const first = entry.args["firstFile"];
	return typeof first === "string" ? `${steps} · ${first}` : steps;
}
