import { createServer } from "node:net";
import { LOOPBACK, TIMING } from "./env.ts";
import type { FigmaSimulator } from "./figma-simulator.ts";

const POLL_MS = 15;

// Espera a que se cumpla algo; falla diciendo QUÉ no ocurrió (no un timeout mudo)
export async function until(
	what: string,
	check: () => boolean | Promise<boolean>,
	timeoutMs: number = TIMING.waitMs,
): Promise<void> {
	const start = Date.now();
	while (!(await check())) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`no ocurrió en ${timeoutMs} ms: ${what}`);
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
}

// Libera una puerta del simulador cuando ya hay un script esperando en ella: un `release` que llega antes que
// el script se pierde (el script se quedaría esperando hasta su plazo)
export async function releaseGate(
	simulator: FigmaSimulator | null,
	gate: string,
): Promise<void> {
	await until(
		`un script espera en la puerta ${gate}`,
		() => (simulator?.waiting(gate) ?? 0) > 0,
	);
	simulator?.release(gate);
}

// Un puerto libre en loopback (se abre y se cierra: la carrera hasta que lo use el proceso es mínima)
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, LOOPBACK, () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}
