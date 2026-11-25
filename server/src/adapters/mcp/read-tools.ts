import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { makeExportNodes } from "#application/export-nodes.ts";
import type { makeReadComponents } from "#application/read-components.ts";
import type { makeReadDesignContext } from "#application/read-design-context.ts";
import type { makeReadInstances } from "#application/read-instances.ts";
import type { makeReadStyles } from "#application/read-styles.ts";
import type { makeReadVariables } from "#application/read-variables.ts";
import type { ActivityRecorder } from "#application/record-activity.ts";
import type { ReadRun } from "#application/run-read.ts";
import {
	designContextOutput,
	readOutput,
	reply,
	type ToolReply,
	usageError,
} from "./presenters.ts";
import {
	componentsInput,
	designContextInput,
	designContextOutputShape,
	exportInput,
	instancesInput,
	readOutputShape,
	stylesInput,
	variablesInput,
} from "./read-schemas.ts";
import { TOOL_NAME } from "./schemas.ts";
import { OPEN_WORLD_READ } from "./tools.ts";
import { track } from "./track.ts";

export type ReadUseCases = {
	readonly variables: ReturnType<typeof makeReadVariables>;
	readonly styles: ReturnType<typeof makeReadStyles>;
	readonly components: ReturnType<typeof makeReadComponents>;
	readonly instances: ReturnType<typeof makeReadInstances>;
	readonly export: ReturnType<typeof makeExportNodes>;
	readonly designContext: ReturnType<typeof makeReadDesignContext>;
};

// Lo común a las cinco descripciones: dónde queda el resultado y cómo seguir una lectura larga
const COMMON =
	"Solo lectura: no modifica Figma (touchedNodeIds siempre vacío). El JSON completo va a reads/ de la carpeta de salida del proyecto y la respuesta trae `path` y un `summary` con conteos; lee el fichero desde la ruta, no esperes la lista en la respuesta. Si tarda más que el plazo blando devuelve status=running y un jobId: consulta figma_get_job (con waitMs). Funciona aunque haya un figma_build en marcha (puede ver una pantalla a medio construir).";

const present = (run: ReadRun): ToolReply => {
	if (run.kind === "usage") return usageError(run.message);
	const output = readOutput(run);
	return reply(output, !output.ok);
};

export function registerReadTools(
	server: McpServer,
	uc: ReadUseCases,
	recorder: ActivityRecorder,
): void {
	server.registerTool(
		TOOL_NAME.variables,
		{
			title: "Variables del archivo",
			description: `Lee las colecciones de variables locales: modos, valores por modo y alias (id y nombre de la variable a la que apuntan; nombre null si es remota). \`collection\` filtra por nombre exacto; con \`nodeId\`, solo las variables ligadas en ese subárbol y \`bindings\` (nodo, campo, variable). ${COMMON}`,
			inputSchema: variablesInput,
			outputSchema: readOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.variables, args, async () =>
				present(await uc.variables(args)),
			),
	);

	server.registerTool(
		TOOL_NAME.styles,
		{
			title: "Estilos del archivo",
			description: `Lista los estilos locales (paint, text, effect, grid) con id, clave, nombre, descripción, variables ligadas y un valor corto (pinturas, tipografía, efectos o retículas). \`kind\` pide un solo tipo. ${COMMON}`,
			inputSchema: stylesInput,
			outputSchema: readOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.styles, args, async () =>
				present(await uc.styles(args)),
			),
	);

	server.registerTool(
		TOOL_NAME.components,
		{
			title: "Catálogo de componentes",
			description: `Lista los sets de componentes (con las opciones de cada variante y las propiedades que no son variante) y los componentes sueltos, con página y descripción. \`page\` filtra por nombre exacto de página y \`query\` por texto en el nombre. ${COMMON}`,
			inputSchema: componentsInput,
			outputSchema: readOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.components, args, async () =>
				present(await uc.components(args)),
			),
	);

	server.registerTool(
		TOOL_NAME.instances,
		{
			title: "Instancias por frame",
			description: `Cuenta, por cada frame de primer nivel de las páginas pedidas, las instancias por nombre del set (si el principal es una variante) o del componente, sin contar lo oculto dentro de instancias. Útil para auditar qué componentes usa cada pantalla. ${COMMON}`,
			inputSchema: instancesInput,
			outputSchema: readOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.instances, args, async () =>
				present(await uc.instances(args)),
			),
	);

	server.registerTool(
		TOOL_NAME.export,
		{
			title: "Exportar nodos",
			description: `Exporta nodos a PNG, JPG, SVG o PDF: un fichero por nodo en exports/ de la carpeta de salida del proyecto y, en \`path\`, el índice { nodeId, path, bytes, width?, height? }[]. Para revisar a ojo un nodo usa figma_screenshot (sale en Capturas del panel; esto no). Más nodos que FIGMA_EXPORT_MAX_NODES es un error de uso. ${COMMON}`,
			inputSchema: exportInput,
			outputSchema: readOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.export, args, async () =>
				present(await uc.export(args)),
			),
	);

	server.registerTool(
		TOOL_NAME.designContext,
		{
			title: "Contexto de diseño de un nodo",
			description: `Diseño a código: lee un nodo de Figma (un frame de pantalla, una instancia o un set de componentes) y deja en reads/ su contexto design-context@1 para escribir o actualizar la plantilla 1 a 1. Es un JSON plano, no código: el árbol en anchura con auto-layout, relleno, bordes, radios, texto y estilos; cada valor ligado sale como su variable resuelta (nombre, colección y valor en el modo por defecto) o su estilo, y lo que no está ligado sale como valor suelto (\`hints.unmapped\`: o falta un token o el diseño se salió del sistema); en lo que no es una instancia, \`hints.classes\` da las clases que map@1 sabe escribir. Una instancia lleva su componente, su variante, sus propiedades y lo que cambió, sin bajar dentro salvo en sus huecos; cada componente lleva su hoja y su plantilla (\`code.source\`, \`code.tag\`; \`code.by\` dice si se encontró por la clave fcc:sheet: o por el nombre del set) o, si no la tiene, el aviso NO_CODE_MAPPING con las candidatas. \`origin\` dice de qué viene el frame (área, pantalla, hoja o compose). Con un set como \`nodeId\` solo se recorre una variante (\`variant\` o la por defecto). Además saca la captura del nodo (\`screenshot: false\` la quita): es el objetivo visual. No genera código ni escribe en el proyecto. ${COMMON}`,
			inputSchema: designContextInput,
			outputSchema: designContextOutputShape,
			annotations: OPEN_WORLD_READ,
		},
		(args) =>
			track(recorder, TOOL_NAME.designContext, args, async () => {
				const run = await uc.designContext(args);
				if (run.kind === "usage") return usageError(run.message);
				const output = designContextOutput(run);
				return reply(output, !output.ok);
			}),
	);
}
