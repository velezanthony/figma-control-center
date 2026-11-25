import { z } from "zod";
import type {
	ComponentsQuery,
	ExportQuery,
	FigmaReader,
	InstancesQuery,
	VariablesQuery,
} from "#application/ports/figma-reader.ts";
import {
	COMPONENT_TYPE,
	type ComponentEntry,
	EXPORT_FORMAT,
	type ExportedBytes,
	type FrameInstances,
	STYLE_KIND,
	type StyleEntry,
	type StyleKind,
	type VariablesRead,
} from "#domain/catalog.ts";
import type { DesignContextQuery, DesignRead } from "#domain/design-context.ts";
import { designVariantError, type FigmaError } from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { SCRIPT_FORMAT } from "#domain/script-format.ts";
import { DesignReadSchema } from "../contracts/design-context.ts";
import type { CdpClient } from "./cdp-client.ts";
import { unexpectedReply } from "./cdp-figma-gateway.ts";
import { pngSize } from "./png.ts";
import { wrapScript } from "./script-wrapper.ts";
import { COMPONENTS_SCRIPT } from "./scripts/components.ts";
import { DESIGN_CONTEXT_SCRIPT } from "./scripts/design-context.ts";
import { EXPORT_SCRIPT } from "./scripts/export.ts";
import { INSTANCES_SCRIPT } from "./scripts/instances.ts";
import { STYLES_SCRIPT } from "./scripts/styles.ts";
import { VARIABLES_SCRIPT } from "./scripts/variables.ts";

// Lo que se acepta de cada script interno: la forma, no lo que Figma guarde dentro (el contrato fino está en los tests)
const ModeValueSchema = z.union([
	z.boolean(),
	z.number(),
	z.string(),
	z.record(z.string(), z.unknown()),
]);
const VariablesSchema = z.object({
	collections: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			modes: z.array(z.object({ id: z.string(), name: z.string() })),
			defaultModeId: z.string(),
			variables: z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					resolvedType: z.string(),
					scopes: z.array(z.string()),
					description: z.string(),
					valuesByMode: z.record(z.string(), ModeValueSchema),
				}),
			),
		}),
	),
	bindings: z
		.array(
			z.object({
				nodeId: z.string(),
				field: z.string(),
				variableId: z.string(),
			}),
		)
		.optional(),
});
const StylesSchema = z.object({
	styles: z.array(
		z.object({
			id: z.string(),
			key: z.string(),
			name: z.string(),
			kind: z.enum(Object.values(STYLE_KIND)),
			description: z.string(),
			boundVariables: z.record(z.string(), z.unknown()),
			value: z.unknown(),
		}),
	),
});
const ComponentsSchema = z.object({
	components: z.array(
		z.object({
			id: z.string(),
			key: z.string(),
			name: z.string(),
			type: z.enum(Object.values(COMPONENT_TYPE)),
			page: z.string(),
			pageIndex: z.number(),
			description: z.string(),
			variants: z.record(z.string(), z.array(z.string())),
			properties: z.array(
				z.object({
					name: z.string(),
					type: z.string(),
					defaultValue: z.union([z.string(), z.boolean(), z.null()]),
				}),
			),
			variantCount: z.number(),
		}),
	),
});
const InstancesSchema = z.object({
	frames: z.array(
		z.object({
			page: z.string(),
			frameId: z.string(),
			frameName: z.string(),
			counts: z.record(z.string(), z.number()),
		}),
	),
});
const ExportSchema = z.object({
	nodes: z.array(z.object({ nodeId: z.string(), base64: z.string() })),
});

// Dónde no cumple la respuesta, para poder diagnosticarlo: los nombres de lo que se atraviesa hasta el campo (un
// componente, una propiedad, un frame…) y lo que queda del camino. P. ej. «Td» › «Hueco#1:0», campo defaultValue
const whereItFails = (raw: unknown, path: readonly PropertyKey[]): string => {
	const names: string[] = [];
	let field: PropertyKey[] = [];
	let node = raw;
	for (const key of path) {
		node =
			typeof node === "object" && node !== null
				? (node as Record<PropertyKey, unknown>)[key]
				: undefined;
		field.push(key);
		const label =
			typeof node === "object" && node !== null
				? ((node as { name?: unknown }).name ??
					(node as { frameName?: unknown }).frameName)
				: undefined;
		if (typeof label === "string") {
			names.push(`«${label}»`);
			field = [];
		}
	}
	const fieldText = field
		.map((k, i) =>
			typeof k === "number" ? `[${k}]` : `${i === 0 ? "" : "."}${String(k)}`,
		)
		.join("");
	return [names.join(" › "), fieldText && `campo ${fieldText}`]
		.filter(Boolean)
		.join(", ");
};

// Lee el catálogo con los scripts internos (los mismos que usan las sondas contra el archivo de pruebas). Ninguno escribe:
// lo vigila server/test/architecture.test.ts
export class CdpFigmaReader implements FigmaReader {
	readonly #client: CdpClient;

	constructor(client: CdpClient) {
		this.#client = client;
	}

	ready(): Promise<Result<true, FigmaError>> {
		return this.#client.ready();
	}

	// La entrada viaja como `params` del envoltorio: el script interno es un texto fijo
	async #read<S extends z.ZodType>(
		code: string,
		params: unknown,
		schema: S,
		what: string,
	): Promise<Result<z.infer<S>, FigmaError>> {
		const { expression, lineOffset } = wrapScript({
			code,
			format: SCRIPT_FORMAT.body,
			params,
		});
		const raw = await this.#client.evaluate(expression, { lineOffset });
		if (!raw.ok) return raw;
		const parsed = schema.safeParse(raw.value);
		if (parsed.success) return ok(parsed.data);
		const issue = parsed.error.issues[0];
		return err(
			unexpectedReply(
				what,
				issue === undefined ? undefined : whereItFails(raw.value, issue.path),
			),
		);
	}

	async variables(
		query: VariablesQuery,
	): Promise<Result<VariablesRead, FigmaError>> {
		const r = await this.#read(
			VARIABLES_SCRIPT,
			query,
			VariablesSchema,
			"las variables",
		);
		if (!r.ok) return r;
		const { collections, bindings } = r.value;
		return ok({ collections, ...(bindings !== undefined && { bindings }) });
	}

	async styles(
		kind: StyleKind | null,
	): Promise<Result<readonly StyleEntry[], FigmaError>> {
		const r = await this.#read(
			STYLES_SCRIPT,
			{ kind },
			StylesSchema,
			"los estilos",
		);
		return r.ok ? ok(r.value.styles) : r;
	}

	async components(
		query: ComponentsQuery,
	): Promise<Result<readonly ComponentEntry[], FigmaError>> {
		const r = await this.#read(
			COMPONENTS_SCRIPT,
			query,
			ComponentsSchema,
			"los componentes",
		);
		return r.ok ? ok(r.value.components) : r;
	}

	async instances(
		query: InstancesQuery,
	): Promise<Result<readonly FrameInstances[], FigmaError>> {
		const r = await this.#read(
			INSTANCES_SCRIPT,
			query,
			InstancesSchema,
			"las instancias",
		);
		return r.ok ? ok(r.value.frames) : r;
	}

	async export(
		query: ExportQuery,
	): Promise<Result<readonly ExportedBytes[], FigmaError>> {
		const r = await this.#read(
			EXPORT_SCRIPT,
			query,
			ExportSchema,
			"la exportación",
		);
		if (!r.ok) return r;
		return ok(
			r.value.nodes.map((node) => {
				const bytes = Buffer.from(node.base64, "base64");
				const size = query.format === EXPORT_FORMAT.png ? pngSize(bytes) : null;
				return {
					nodeId: node.nodeId,
					bytes: new Uint8Array(bytes),
					...(size !== null && size),
				};
			}),
		);
	}

	async designContext(
		query: DesignContextQuery,
	): Promise<Result<DesignRead, FigmaError>> {
		const r = await this.#read(
			DESIGN_CONTEXT_SCRIPT,
			query,
			DesignReadSchema,
			"el contexto de diseño",
		);
		if (!r.ok) return r;
		if ("unknownVariant" in r.value)
			return err(
				designVariantError(
					query.variant ?? {},
					r.value.unknownVariant.variants,
				),
			);
		return ok(r.value);
	}
}
