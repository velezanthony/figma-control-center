import type { ReadFile, ReadSummary } from "#domain/catalog.ts";
import { READ_KIND } from "#domain/catalog.ts";
import { type PaintMatch, toCode } from "#domain/design-context/to-code.ts";
import {
	DESIGN_CONTEXT_CONTRACT,
	DESIGN_CONTEXT_SCREENSHOT_SCALE,
	DESIGN_WARNING,
	type DesignContext,
	type DesignOrigin,
	type DesignWarning,
	ORIGIN_KIND,
} from "#domain/design-context.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { ProjectConfigSource } from "./ports/project-config.ts";
import { type ReadDeps, type ReadRun, storeRead } from "./run-read.ts";
import type { ScreenshotFile } from "./take-screenshot.ts";

// Cuántos avisos y valores sueltos salen en la respuesta (el fichero los lleva todos): la conversación no es un volcado
const LISTED = 5;
const AREA_SCREEN_SEPARATOR = "/";

export type ReadDesignContextInput = {
	readonly nodeId: string;
	readonly maxNodes?: number | undefined;
	// Con `false` no se saca la captura del nodo
	readonly screenshot?: boolean | undefined;
	// Con un set como raíz: la variante que se recorre
	readonly variant?: Readonly<Record<string, string>> | undefined;
};

// Un nodo con valores sueltos: lo que hay que mirar dos veces
export type UnmappedNode = {
	readonly node: string;
	readonly name: string;
	readonly fields: readonly string[];
};

export type DesignContextFile = ReadFile & {
	readonly screenshotPath: string | null;
	// Los primeros avisos (el fichero los lleva todos)
	readonly warnings: readonly DesignWarning[];
	readonly unmapped: readonly UnmappedNode[];
	// Cuántos nodos quedaron sin leer, para pedirlos aparte (sus ids, en el fichero); null si se leyó todo
	readonly truncated: {
		readonly reason: string;
		readonly missing: number;
	} | null;
};

export type ReadDesignContextDeps = ReadDeps & {
	// Sheets, map y huellas del proyecto: de ahí sale el mapeo a código
	readonly project: ProjectConfigSource;
	// La captura del nodo: la misma pieza que figma_screenshot
	readonly screenshot: (
		nodeId: string,
		scale: number,
	) => Promise<Result<ScreenshotFile, FigmaError>>;
	// Lo que dejó el último kit/build-screen@1 de una pantalla (de su `report.matches`)
	readonly paintMatches: (screen: string) => readonly PaintMatch[];
	// Clave del archivo de Figma del proyecto
	readonly fileKey: string;
	// FIGMA_DESIGN_CONTEXT_MAX_NODES
	readonly maxNodes: number;
};

// La pantalla de la que viene un frame pintado: la clave de `screen` o, en un área, lo que va tras la «/» (`<área>/<pantalla>`)
const screenOf = (origin: DesignOrigin | undefined): string | null => {
	if (origin === undefined) return null;
	if (origin.kind === ORIGIN_KIND.screen) return origin.key;
	if (origin.kind !== ORIGIN_KIND.area) return null;
	const at = origin.key.lastIndexOf(AREA_SCREEN_SEPARATOR);
	return at === -1 ? origin.key : origin.key.slice(at + 1);
};

const summaryOf = (
	context: DesignContext,
	noCodeMapping: number,
	unmapped: number,
): ReadSummary => ({
	nodes: context.nodes.length,
	components: Object.keys(context.components).length,
	variables: Object.keys(context.variables).length,
	styles: Object.keys(context.styles).length,
	noCodeMapping,
	unmapped,
});

// figma_design_context: el nodo como design-context@1 en reads/, con su captura al lado y el
// mapeo a la plantilla de cada componente. Solo lee: ni Figma ni el código del proyecto se modifican
export const makeReadDesignContext =
	(deps: ReadDesignContextDeps) =>
	(input: ReadDesignContextInput): Promise<ReadRun<DesignContextFile>> =>
		deps.runRead(async (): Promise<Result<DesignContextFile, FigmaError>> => {
			const project = await deps.project.load();
			if (!project.ok) return err(project.error);
			const read = await deps.reader.designContext({
				nodeId: input.nodeId,
				maxNodes: input.maxNodes ?? deps.maxNodes,
				variant: input.variant ?? null,
			});
			if (!read.ok) return read;

			const screen = screenOf(read.value.origin);
			const mapped = toCode({
				read: read.value,
				sheets: (project.value.sheets?.sheets ?? []).map((s) => ({
					key: s.key,
					title: s.title,
					source: s.source,
					tag: s.tag,
				})),
				tokens: project.value.map?.tokens ?? null,
				fingerprintTitles: Object.fromEntries(
					Object.entries(project.value.fingerprints).map(([name, f]) => [
						name,
						f.title,
					]),
				),
				matches: screen === null ? [] : deps.paintMatches(screen),
			});

			const warnings: DesignWarning[] = [...mapped.warnings];
			let screenshotPath: string | null = null;
			if (input.screenshot !== false) {
				const shot = await deps.screenshot(
					input.nodeId,
					DESIGN_CONTEXT_SCREENSHOT_SCALE,
				);
				if (shot.ok) screenshotPath = shot.value.path;
				else
					warnings.push({
						code: DESIGN_WARNING.screenshotFailed,
						message: `No se pudo sacar la captura del nodo ${input.nodeId}: ${shot.error.message}`,
					});
			}

			const context: DesignContext = {
				contract: DESIGN_CONTEXT_CONTRACT,
				file: { key: deps.fileKey, name: read.value.fileName },
				readAt: deps.clock().toISOString(),
				root: read.value.root,
				...(read.value.origin !== undefined && { origin: read.value.origin }),
				nodes: mapped.nodes,
				variables: mapped.variables,
				styles: read.value.styles,
				components: mapped.components,
				...(read.value.truncated !== undefined && {
					truncated: read.value.truncated,
				}),
				...(warnings.length > 0 && { warnings }),
			};
			const loose: UnmappedNode[] = mapped.nodes.flatMap((n) =>
				n.hints === undefined || n.hints.unmapped.length === 0
					? []
					: [{ node: n.id, name: n.name, fields: n.hints.unmapped }],
			);
			const noCode = warnings.filter(
				(w) => w.code === DESIGN_WARNING.noCodeMapping,
			).length;
			const file = await storeRead(
				deps,
				`${READ_KIND.designContext}_${input.nodeId}`,
				context,
				summaryOf(context, noCode, loose.length),
			);
			return ok({
				...file,
				screenshotPath,
				warnings: warnings.slice(0, LISTED),
				unmapped: loose.slice(0, LISTED),
				truncated:
					context.truncated === undefined
						? null
						: {
								reason: context.truncated.reason,
								missing: context.truncated.children.length,
							},
			});
		});
