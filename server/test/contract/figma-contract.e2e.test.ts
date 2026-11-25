// make e2e-contract (opt-in, FCC_E2E=1): lanza las sondas contra el archivo de pruebas archivo de pruebas y valida CADA
// respuesta real contra los contratos de las fronteras (tipos de error, campos, estructura de la pila, tipos de los
// valores). Si una no cumple, hay que revisar el contrato (y los ejemplos de server/test/fixtures/scenarios/).
// Sustituye al E2E contra Figma real anterior. Solo contra el archivo de pruebas: la guarda por fileKey se niega a otra cosa.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { bootLayered } from "#adapters/config/env.ts";
import { EvaluateResponseSchema } from "../contracts/cdp.ts";
import {
	assertTestingFile,
	requireTestFile,
} from "../support/test-file-guard.ts";
import { checkProbeReply } from "./check-probe.ts";
import { evaluation, PROBES, READY_EXPRESSION } from "./probes.ts";
import { openTestingTab, type RawSession } from "./raw-cdp.ts";

// Las pruebas de contrato no son de ningún proyecto: solo necesitan lo de máquina (CDP, archivo de pruebas, salida)
const { machine } = bootLayered;

const CALL_TIMEOUT_MS = 30_000;
const READY_PROBE = {
	id: "ready",
	code: "",
	format: "body",
	expects: "ready",
} as const;

describe("contrato contra Figma real (archivo de pruebas)", {
	skip: !machine.e2e.enabled,
}, () => {
	let session: RawSession;
	let testFileUrl: string;

	before(async () => {
		testFileUrl = requireTestFile(machine.figma.testFileUrl);
		session = await openTestingTab({
			host: machine.cdp.host,
			port: machine.cdp.port,
			testFileUrl,
		});
	});

	after(() => session?.close());

	it("la pestaña elegida es la del archivo de pruebas", () => {
		assertTestingFile(session.tabUrl, testFileUrl);
	});

	it("«typeof figma» cumple el contrato", async () => {
		const reply = await session.evaluate(READY_EXPRESSION, CALL_TIMEOUT_MS);
		assert.deepEqual(checkProbeReply(READY_PROBE, reply), []);
	});

	for (const probe of PROBES) {
		it(`sonda ${probe.id}: la respuesta cumple el contrato`, async () => {
			const reply = await session.evaluate(
				evaluation(probe).expression,
				CALL_TIMEOUT_MS,
			);
			assert.equal(
				EvaluateResponseSchema.safeParse(reply).success,
				true,
				"el mensaje de CDP no es un Runtime.evaluate válido",
			);
			assert.deepEqual(checkProbeReply(probe, reply), []);
		});
	}
});
