import type {
	HistoryMaintenance,
	PruneResult,
} from "./ports/history-maintenance.ts";

const MS_PER_DAY = 86_400_000;

export function makePruneHistory(deps: {
	readonly maintenance: HistoryMaintenance;
	readonly retentionDays: number;
	readonly now: () => Date;
}): () => PruneResult {
	return () => {
		const cutoff = new Date(
			deps.now().getTime() - deps.retentionDays * MS_PER_DAY,
		);
		return deps.maintenance.prune(cutoff);
	};
}
