import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS_DIR } from "../fixtures/scenarios/scenarios.ts";

export const scenarioPath = (file: string): string => join(SCRIPTS_DIR, file);

// Línea (desde 1) del script donde aparece el marcador: el valor que DEBE informar el adaptador
export function markerLine(file: string, marker: string): number {
	const lines = readFileSync(scenarioPath(file), "utf8").split("\n");
	const at = lines.findIndex((l) => l.includes(marker));
	if (at === -1) throw new Error(`${file} no tiene el marcador ${marker}`);
	return at + 1;
}
