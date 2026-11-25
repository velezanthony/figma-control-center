import type { ExportFormat } from "#domain/catalog.ts";
import type { StoredResult } from "#domain/run-outcome.ts";

// De qué es una captura: el nodo y cuándo se hizo (su nombre en disco sale de ahí)
export type ScreenshotName = { readonly nodeId: string; readonly at: Date };
// De qué herramienta es una lectura y cuándo se hizo (nombre con herramienta y fecha)
export type ReadName = { readonly tool: string; readonly at: Date };
// Qué nodo se exportó, en qué formato y cuándo
export type ExportName = {
	readonly nodeId: string;
	readonly format: ExportFormat;
	readonly at: Date;
};

export interface ResultStore {
	saveJson(json: string): Promise<StoredResult>;
	savePng(png: Uint8Array, name: ScreenshotName): Promise<StoredResult>;
	// reads/: el JSON completo de una lectura del catálogo
	saveRead(json: string, name: ReadName): Promise<StoredResult>;
	// exports/: los bytes de un nodo exportado
	saveExport(bytes: Uint8Array, name: ExportName): Promise<StoredResult>;
	// results/<fileName>: el resultado de un script con nombre fijo (se pisa si existe). El nombre ya viene
	// validado (isResultFileName): uno que no lo cumple es un bug y lanza sin escribir nada
	saveResult(fileName: string, json: string): Promise<StoredResult>;
	// history-scripts/<sha256>.<ext>: un contenido del historial de intentos pedido por figma_history_script (se pisa
	// si existe: es el mismo contenido). `sha256` ya viene validado como 64 caracteres hexadecimales
	saveScript(
		sha256: string,
		extension: "js" | "json",
		content: string,
	): Promise<StoredResult>;
	// history-diffs/<fileName>: el diff entero de dos intentos pedido por figma_history_diff (se pisa si existe). El
	// nombre ya viene saneado (letras, cifras, «.», «_» y «-», acabado en «.diff»): uno que no lo cumple es un bug y lanza
	saveDiff(fileName: string, text: string): Promise<StoredResult>;
}
