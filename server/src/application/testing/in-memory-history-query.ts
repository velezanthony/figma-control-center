import type { HistoryQuery, Rows } from "#application/ports/history-query.ts";
import type {
	AttemptItem,
	AttemptKind,
	AttemptSummary,
	AttemptTarget,
	ScriptLookup,
	ScriptSelector,
} from "#domain/attempt.ts";
import type {
	CallItem,
	CallsPage,
	CallsQuery,
	CaptureItem,
	ConnectionStatus,
	ErrorGroup,
	HistorySummary,
	NodeTouch,
	ResolvedRange,
	SessionItem,
	StoredBuildStep,
} from "#domain/history.ts";

const NO_RANGE: ResolvedRange = { fromMs: null, toMs: null, sessionId: null };
const rows = <T>(items: readonly T[] = []): Rows<T> => ({
	items,
	total: items.length,
});

export const EMPTY_SUMMARY: HistorySummary = {
	range: NO_RANGE,
	calls: 0,
	writes: 0,
	errors: 0,
	running: 0,
	meanMs: null,
	p95Ms: null,
	jobs: 0,
	nodesTouched: 0,
	topTools: [],
};

// Fake con respuesta programable por método y registro de lo que se le pidió
export class InMemoryHistoryQuery implements HistoryQuery {
	summaryReply: HistorySummary = EMPTY_SUMMARY;
	errorsReply: Rows<ErrorGroup> = rows();
	nodesReply: Rows<NodeTouch> = rows();
	sessionsReply: Rows<SessionItem> = rows();
	callsReply: Omit<CallsPage, "truncated"> = {
		items: [],
		total: 0,
		page: 1,
		perPage: 25,
	};
	callReply: CallItem | null = null;
	stepsReply: readonly StoredBuildStep[] = [];
	capturesReply: Rows<CaptureItem> = rows();
	statusReply: ConnectionStatus | null = null;
	attemptTargetsReply: Rows<AttemptTarget> = rows();
	attemptsReply: Rows<AttemptItem> = rows();
	// Si está, decide qué contenido da cada selector (si no, `storedScriptReply`)
	storedScriptFor: ((selector: ScriptSelector) => ScriptLookup) | null = null;
	targetAttemptsReply: Rows<AttemptItem> = rows();
	// Los intentos que `attemptById` conoce (el resto, null)
	readonly attemptsById = new Map<number, AttemptItem>();
	attemptsOfCallReply: readonly AttemptSummary[] = [];
	storedScriptReply: ScriptLookup = { kind: "not_found" };

	readonly summaryCalls: { range: ResolvedRange; topTools: number }[] = [];
	readonly errorsCalls: { range: ResolvedRange; limit: number }[] = [];
	readonly nodesCalls: { range: ResolvedRange; limit: number }[] = [];
	readonly sessionsCalls: { range: ResolvedRange; limit: number }[] = [];
	readonly callsCalls: CallsQuery[] = [];
	readonly callCalls: string[] = [];
	readonly stepsCalls: string[] = [];
	readonly capturesCalls: { page: number; perPage: number }[] = [];
	readonly attemptTargetsCalls: object[] = [];
	readonly attemptsCalls: object[] = [];
	readonly targetAttemptsCalls: object[] = [];
	readonly attemptByIdCalls: number[] = [];
	readonly attemptsOfCallCalls: string[] = [];
	readonly storedScriptCalls: ScriptSelector[] = [];

	summary(range: ResolvedRange, topTools: number): HistorySummary {
		this.summaryCalls.push({ range, topTools });
		return this.summaryReply;
	}
	errors(range: ResolvedRange, limit: number): Rows<ErrorGroup> {
		this.errorsCalls.push({ range, limit });
		return this.errorsReply;
	}
	nodes(range: ResolvedRange, limit: number): Rows<NodeTouch> {
		this.nodesCalls.push({ range, limit });
		return this.nodesReply;
	}
	sessions(range: ResolvedRange, limit: number): Rows<SessionItem> {
		this.sessionsCalls.push({ range, limit });
		return this.sessionsReply;
	}
	calls(query: CallsQuery): Omit<CallsPage, "truncated"> {
		this.callsCalls.push(query);
		return this.callsReply;
	}
	call(callId: string): CallItem | null {
		this.callCalls.push(callId);
		return this.callReply;
	}
	steps(jobId: string): readonly StoredBuildStep[] {
		this.stepsCalls.push(jobId);
		return this.stepsReply;
	}
	attemptTargets(
		query: Parameters<HistoryQuery["attemptTargets"]>[0],
	): Rows<AttemptTarget> {
		this.attemptTargetsCalls.push(query);
		return this.attemptTargetsReply;
	}
	targetAttempts(
		query: Parameters<HistoryQuery["targetAttempts"]>[0],
	): Rows<AttemptItem> {
		this.targetAttemptsCalls.push(query);
		return this.targetAttemptsReply;
	}
	attemptById(id: number): AttemptItem | null {
		this.attemptByIdCalls.push(id);
		return this.attemptsById.get(id) ?? null;
	}
	attempts(query: {
		readonly target: string;
		readonly kind: AttemptKind | null;
		readonly sinceMs: number | null;
		readonly limit: number;
	}): Rows<AttemptItem> {
		this.attemptsCalls.push(query);
		return this.attemptsReply;
	}
	attemptsOfCall(callId: string): readonly AttemptSummary[] {
		this.attemptsOfCallCalls.push(callId);
		return this.attemptsOfCallReply;
	}
	storedScript(selector: ScriptSelector): ScriptLookup {
		this.storedScriptCalls.push(selector);
		return this.storedScriptFor?.(selector) ?? this.storedScriptReply;
	}
	captures(page: number, perPage: number): Rows<CaptureItem> {
		this.capturesCalls.push({ page, perPage });
		return this.capturesReply;
	}
	lastStatus(): ConnectionStatus | null {
		return this.statusReply;
	}
}
