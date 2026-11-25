import type { ActivityLog } from "#application/ports/activity-log.ts";
import type { ActivityEvent } from "#domain/activity.ts";

export class InMemoryActivityLog implements ActivityLog {
	readonly events: ActivityEvent[] = [];

	record(event: ActivityEvent): void {
		this.events.push(event);
	}
}
