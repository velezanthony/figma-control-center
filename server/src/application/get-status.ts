import type { JobRegistry } from "./job-registry.ts";
import type { FigmaGateway, FigmaStatus } from "./ports/figma-gateway.ts";

export type StatusReport = FigmaStatus & {
	// Un script que venció su plazo sigue en la pestaña: las escrituras se rechazan hasta que acabe o se recargue
	readonly previousScriptRunning: boolean;
};

export const makeGetStatus =
	(gateway: FigmaGateway, jobs: JobRegistry) =>
	async (): Promise<StatusReport> => ({
		...(await gateway.status()),
		previousScriptRunning: jobs.staleScript(),
	});
