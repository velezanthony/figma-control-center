import type {
	ComponentEntry,
	ExportedBytes,
	ExportFormat,
	FrameInstances,
	StyleEntry,
	StyleKind,
	VariablesRead,
} from "#domain/catalog.ts";
import type { DesignContextQuery, DesignRead } from "#domain/design-context.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";

export type VariablesQuery = {
	// Nombre exacto de la colección (null: todas)
	readonly collection: string | null;
	// Subárbol del que salen las variables ligadas (null: todas las locales)
	readonly nodeId: string | null;
};

export type ComponentsQuery = {
	readonly page: string | null;
	readonly query: string | null;
};

export type InstancesQuery = {
	readonly pages: readonly string[];
	readonly frame: string | null;
};

export type ExportQuery = {
	readonly nodeIds: readonly string[];
	readonly format: ExportFormat;
	readonly scale: number;
};

// Lectura del catálogo del archivo: otra intención que FigmaGateway, sin ningún método que escriba.
export interface FigmaReader {
	// Espera a que la pestaña esté lista sin enviar nada (lo mismo que FigmaGateway.ready)
	ready(): Promise<Result<true, FigmaError>>;
	variables(query: VariablesQuery): Promise<Result<VariablesRead, FigmaError>>;
	styles(
		kind: StyleKind | null,
	): Promise<Result<readonly StyleEntry[], FigmaError>>;
	components(
		query: ComponentsQuery,
	): Promise<Result<readonly ComponentEntry[], FigmaError>>;
	instances(
		query: InstancesQuery,
	): Promise<Result<readonly FrameInstances[], FigmaError>>;
	export(
		query: ExportQuery,
	): Promise<Result<readonly ExportedBytes[], FigmaError>>;
	// El nodo como design-context@1 sin el mapeo a código. ContractError si `variant` no existe
	designContext(
		query: DesignContextQuery,
	): Promise<Result<DesignRead, FigmaError>>;
}
