import type { AreasFile } from "#domain/areas.ts";
import type { ProjectConfig, ScreensFile } from "#domain/capture.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import type { Fingerprints, IconEntry, MapFile } from "#domain/map.ts";
import type { Result } from "#domain/result.ts";
import type { SheetsFile } from "#domain/sheets.ts";

// La configuración de captura de un proyecto ya leída y validada: project@1 de
// `figma-control-center.json`, su screens@1 y el módulo de ganchos COMO TEXTO (el proceso Node nunca lo ejecuta)
export type LoadedProject = {
	readonly file: string;
	readonly config: ProjectConfig;
	readonly screens: ScreensFile;
	readonly hooks: { readonly source: string; readonly sha256: string } | null;
	// recognize@1 (F4b): el módulo del proyecto COMO TEXTO (nunca se ejecuta en Node: lo evalúa el kit en la pestaña de Figma)
	readonly recognize: {
		readonly path: string;
		readonly source: string;
		readonly sha256: string;
	} | null;
	// areas@1 (F3), ya validado y cruzado con screens@1; null si el proyecto no declara `areas`
	readonly areas: AreasFile | null;
	// Imagen de relleno (`fills[].asset`, como está escrita) → su ruta real, ya dentro de las raíces
	readonly areaAssets: Readonly<Record<string, string>>;
	// map@1 (F4), ya validado; null si el proyecto no declara `map`. `mapSource` es su ruta real, el sha256 de su texto y el texto;
	// `iconCatalog` es el catálogo al que apunta `icons.catalog`, ya leído
	readonly map: MapFile | null;
	readonly mapSource: {
		readonly path: string;
		readonly sha256: string;
		readonly text: string;
	} | null;
	readonly iconCatalog: readonly IconEntry[];
	// Las huellas de componentes (F4b) a las que apunta `map.components.fingerprints`; vacío si no las hay
	readonly fingerprints: Fingerprints;
	// sheets@1 (hojas de componentes), ya validado y cruzado con screens@1; null si el proyecto no declara `sheets`.
	// `sheetsSource` es su ruta real, el sha256 de su texto y el texto
	readonly sheets: SheetsFile | null;
	readonly sheetsSource: {
		readonly path: string;
		readonly sha256: string;
		readonly text: string;
	} | null;
	// Carpeta de los compose@1, ya resuelta y dentro del proyecto; null si no declara `compose`
	readonly composeDir: string | null;
};

export interface ProjectConfigSource {
	// ProjectConfigError con el campo si falta, no cumple o una ruta se sale del proyecto
	load(): Promise<Result<LoadedProject, FigmaError>>;
}
