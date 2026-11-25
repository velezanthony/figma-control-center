import type {
	ComponentsQuery,
	ExportQuery,
	FigmaReader,
	InstancesQuery,
	VariablesQuery,
} from "#application/ports/figma-reader.ts";
import type {
	ComponentEntry,
	ExportedBytes,
	FrameInstances,
	StyleEntry,
	StyleKind,
	VariablesRead,
} from "#domain/catalog.ts";
import type { DesignContextQuery, DesignRead } from "#domain/design-context.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { ok, type Result } from "#domain/result.ts";

type Reply<Q, T> = (query: Q) => Promise<Result<T, FigmaError>>;

// Doble en memoria del puerto: cada lectura responde con lo programado y deja constancia de lo que se le pidió
export class InMemoryFigmaReader implements FigmaReader {
	readonly variablesCalls: VariablesQuery[] = [];
	readonly stylesCalls: (StyleKind | null)[] = [];
	readonly componentsCalls: ComponentsQuery[] = [];
	readonly instancesCalls: InstancesQuery[] = [];
	readonly exportCalls: ExportQuery[] = [];
	readonly designContextCalls: DesignContextQuery[] = [];
	readyCalls = 0;

	readyReply: () => Promise<Result<true, FigmaError>> = () =>
		Promise.resolve(ok(true as const));
	variablesReply: Reply<VariablesQuery, VariablesRead> = () =>
		Promise.resolve(ok({ collections: [] }));
	stylesReply: Reply<StyleKind | null, readonly StyleEntry[]> = () =>
		Promise.resolve(ok([]));
	componentsReply: Reply<ComponentsQuery, readonly ComponentEntry[]> = () =>
		Promise.resolve(ok([]));
	instancesReply: Reply<InstancesQuery, readonly FrameInstances[]> = () =>
		Promise.resolve(ok([]));
	exportReply: Reply<ExportQuery, readonly ExportedBytes[]> = (query) =>
		Promise.resolve(
			ok(
				query.nodeIds.map((nodeId) => ({
					nodeId,
					bytes: new Uint8Array(0),
				})),
			),
		);

	designContextReply: Reply<DesignContextQuery, DesignRead> = (query) =>
		Promise.resolve(
			ok({
				fileName: "Archivo",
				root: query.nodeId,
				nodes: [],
				variables: {},
				styles: {},
				components: {},
			}),
		);

	ready(): Promise<Result<true, FigmaError>> {
		this.readyCalls++;
		return this.readyReply();
	}

	variables(query: VariablesQuery): Promise<Result<VariablesRead, FigmaError>> {
		this.variablesCalls.push(query);
		return this.variablesReply(query);
	}

	styles(
		kind: StyleKind | null,
	): Promise<Result<readonly StyleEntry[], FigmaError>> {
		this.stylesCalls.push(kind);
		return this.stylesReply(kind);
	}

	components(
		query: ComponentsQuery,
	): Promise<Result<readonly ComponentEntry[], FigmaError>> {
		this.componentsCalls.push(query);
		return this.componentsReply(query);
	}

	instances(
		query: InstancesQuery,
	): Promise<Result<readonly FrameInstances[], FigmaError>> {
		this.instancesCalls.push(query);
		return this.instancesReply(query);
	}

	export(
		query: ExportQuery,
	): Promise<Result<readonly ExportedBytes[], FigmaError>> {
		this.exportCalls.push(query);
		return this.exportReply(query);
	}

	designContext(
		query: DesignContextQuery,
	): Promise<Result<DesignRead, FigmaError>> {
		this.designContextCalls.push(query);
		return this.designContextReply(query);
	}
}
