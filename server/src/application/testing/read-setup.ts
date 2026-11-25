import { toJobId } from "#domain/job.ts";
import { ok } from "#domain/result.ts";
import { makeExportNodes } from "../export-nodes.ts";
import { createJobRegistry } from "../job-registry.ts";
import { makeReadComponents } from "../read-components.ts";
import { makeReadDesignContext } from "../read-design-context.ts";
import { makeReadInstances } from "../read-instances.ts";
import { makeReadStyles } from "../read-styles.ts";
import { makeReadVariables } from "../read-variables.ts";
import { makeRunRead } from "../run-read.ts";
import { InMemoryFigmaReader } from "./in-memory-figma-reader.ts";
import { InMemoryResultStore } from "./in-memory-ports.ts";
import { InMemoryProjectConfig, projectWith } from "./in-memory-web-capture.ts";

// 11 de noviembre de 2026, 10:20:30 hora local: la fecha con la que se nombran los ficheros de lectura en los tests
export const READ_AT = new Date(2026, 10, 11, 10, 20, 30);

// Lo común a los tests de las lecturas: el doble del lector, el almacén en memoria y el flujo de jobs real
export function readSetup(overrides: { softDeadlineMs?: number } = {}) {
	const reader = new InMemoryFigmaReader();
	const store = new InMemoryResultStore();
	let n = 0;
	const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
	const runRead = makeRunRead({
		reader,
		jobs,
		softDeadlineMs: overrides.softDeadlineMs ?? 1000,
	});
	return {
		reader,
		store,
		jobs,
		deps: { runRead, reader, store, clock: () => READ_AT },
	};
}

// Las cinco lecturas montadas sobre dobles: para los tests de MCP que necesitan el juego entero de casos de uso
export function inMemoryReads(options: {
	readonly jobs: ReturnType<typeof createJobRegistry>;
	readonly store: InMemoryResultStore;
	readonly reader?: InMemoryFigmaReader;
	readonly softDeadlineMs?: number;
	readonly maxNodes?: number;
}) {
	const reader = options.reader ?? new InMemoryFigmaReader();
	const deps = {
		runRead: makeRunRead({
			reader,
			jobs: options.jobs,
			softDeadlineMs: options.softDeadlineMs ?? 1000,
		}),
		reader,
		store: options.store,
		clock: () => READ_AT,
	};
	return {
		variables: makeReadVariables(deps),
		styles: makeReadStyles(deps),
		components: makeReadComponents(deps),
		instances: makeReadInstances(deps),
		export: makeExportNodes({ ...deps, maxNodes: options.maxNodes ?? 20 }),
		designContext: makeReadDesignContext({
			...deps,
			project: new InMemoryProjectConfig(projectWith([])),
			screenshot: async () =>
				ok({
					path: "/salida/screenshots/x.png",
					bytes: 1,
					width: 1,
					height: 1,
				}),
			paintMatches: () => [],
			fileKey: "KEY",
			maxNodes: 400,
		}),
	};
}
