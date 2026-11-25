// make e2e-record: ejecuta las sondas contra el archivo de pruebas (archivo de pruebas) y guarda las respuestas reales
// SIN interpretar en output/contract-samples/ (fuera de git) para compararlas con los esquemas y los ejemplos.
// Sirve para descubrir campos o formas que el contrato aún no recoge; nunca como dato de los tests.
// Sin secretos: se guarda el mensaje de CDP de cada sonda, no cookies ni cabeceras.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootLayered } from "#adapters/config/env.ts";
import { requireTestFile } from "../support/test-file-guard.ts";
import { evaluation, PROBES, READY_EXPRESSION } from "./probes.ts";
import { openTestingTab, TestingTabNotOpen } from "./raw-cdp.ts";

// Las pruebas de contrato no son de ningún proyecto: solo necesitan lo de máquina (CDP, archivo de pruebas, salida)
const { machine } = bootLayered;

const SAMPLES_DIR = "contract-samples";
// `make e2e-record STATE=<estado>`: guarda solo lo que hay en la pestaña en ese estado (sin sesión, solo lectura…)
const STATE_PROBE = "access-state";
const state = process.argv[2];
const CALL_TIMEOUT_MS = 30_000;
const EXIT = Object.freeze({ refused: 2, tabClosed: 3 } as const);

try {
	const testFileUrl = requireTestFile(machine.figma.testFileUrl);
	const session = await openTestingTab({
		host: machine.cdp.host,
		port: machine.cdp.port,
		testFileUrl,
	});
	const dir = join(bootLayered.outputRoot, SAMPLES_DIR);
	await mkdir(dir, { recursive: true });
	try {
		const ready = await session.evaluate(READY_EXPRESSION, CALL_TIMEOUT_MS);
		await writeFile(
			join(dir, state === undefined ? "ready.json" : `ready.${state}.json`),
			JSON.stringify(ready, null, 2),
		);
		const probes =
			state === undefined ? PROBES : PROBES.filter((p) => p.id === STATE_PROBE);
		for (const probe of probes) {
			const { expression } = evaluation(probe);
			const reply = await session.evaluate(expression, CALL_TIMEOUT_MS);
			await writeFile(
				join(
					dir,
					state === undefined
						? `${probe.id}.json`
						: `${probe.id}.${state}.json`,
				),
				JSON.stringify({ probe: probe.id, reply }, null, 2),
			);
			console.log(`guardada ${probe.id}`);
		}
		console.log(`Muestras en ${dir} (pestaña ${session.tabUrl})`);
	} finally {
		session.close();
	}
} catch (e) {
	console.error(e instanceof Error ? e.message : String(e));
	process.exit(e instanceof TestingTabNotOpen ? EXIT.tabClosed : EXIT.refused);
}
