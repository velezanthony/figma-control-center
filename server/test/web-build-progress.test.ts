// El panel (web/) no puede importar el dominio en tiempo de ejecución, así que repite la cuenta del progreso de un
// lote. Este test las ata: los mismos pasos dan las mismas cifras en el servidor y en la web.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type BuildStep, progressOf } from "#domain/build.ts";
import { buildProgress } from "../../web/src/lib/activity/build-progress.ts";
import type { BuildStepItem } from "../../web/src/lib/contract.ts";

const BATCHES: Record<string, readonly BuildStep["status"][]> = {
	"cancelado durante el 3.º de 4": ["done", "done", "done", "cancelled"],
	"fromStep 2 de 5": ["skipped", "skipped", "pending", "pending", "pending"],
	"con un fallo": ["done", "failed", "cancelled", "cancelled"],
	"en curso": ["done", "running", "pending"],
	vacío: [],
};

describe("el progreso del servidor y el de la web son la misma regla", () => {
	for (const [name, statuses] of Object.entries(BATCHES)) {
		it(name, () => {
			const steps: (BuildStep & BuildStepItem)[] = statuses.map(
				(status, index) => ({
					index,
					file: `s${index}.js`,
					status,
					ms: null,
					touchedCount: 0,
					error: null,
					warning: null,
					result: null,
				}),
			);
			assert.deepEqual(buildProgress(steps), progressOf(steps));
		});
	}
});
