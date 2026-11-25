import type { RangeInput, ResolvedRange } from "#domain/history.ts";
import { err, ok, type Result } from "#domain/result.ts";

export type HistoryUsageError = {
	readonly type: "InvalidRange" | "EmptyQuery" | "NotFound" | "InvalidInput";
	readonly message: string;
};

const HOUR_MS = 3_600_000;

const invalid = (message: string) =>
	err<HistoryUsageError>({ type: "InvalidRange", message });

function parseIso(
	field: "since" | "until",
	raw: string,
): Result<number, HistoryUsageError> {
	const ms = Date.parse(raw);
	return Number.isNaN(ms)
		? invalid(`«${field}» debe ser una fecha ISO 8601 (recibido «${raw}»).`)
		: ok(ms);
}

// «Hoy» es el día local de la máquina donde corre el servidor
const startOfLocalDay = (now: Date): number =>
	new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

export function resolveRange(
	input: RangeInput,
	now: Date,
): Result<ResolvedRange, HistoryUsageError> {
	const sessionId = input.sessionId ?? null;
	const hasExplicit = input.since !== undefined || input.until !== undefined;
	if (input.preset !== undefined && hasExplicit) {
		return invalid("Usa `preset` o `since`/`until`, no los dos a la vez.");
	}
	if (input.preset === "last_hour") {
		return ok({ fromMs: now.getTime() - HOUR_MS, toMs: null, sessionId });
	}
	if (input.preset === "today") {
		return ok({ fromMs: startOfLocalDay(now), toMs: null, sessionId });
	}
	let fromMs: number | null = null;
	let toMs: number | null = null;
	if (input.since !== undefined) {
		const since = parseIso("since", input.since);
		if (!since.ok) return since;
		fromMs = since.value;
	}
	if (input.until !== undefined) {
		const until = parseIso("until", input.until);
		if (!until.ok) return until;
		toMs = until.value;
	}
	if (fromMs !== null && toMs !== null && fromMs > toMs) {
		return invalid("«since» no puede ser posterior a «until».");
	}
	return ok({ fromMs, toMs, sessionId });
}
