// Ningún entorno del arnés deja procesos vivos al pararse, ni siquiera si se para mientras una sesión lanzada desde
// el panel aún está arrancando (antes quedaba la sesión simulada huérfana, adoptada por systemd --user).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AGENT_ROUTE } from "#adapters/http/routes.ts";
import { startEnvironment, TERMINAL_ARGV_FILE } from "./environment.ts";
import { processesOf } from "./processes.ts";
import { until } from "./wait.ts";

const SETTLE_MS = 8000;

describe("el arnés no deja procesos vivos", () => {
	it("parar el entorno con una sesión lanzada que aún no se registró no deja ningún proceso", async () => {
		const env = await startEnvironment({ agentProject: true });
		try {
			const origin = new URL(env.dashboardUrl).host;
			const launched = await fetch(
				`${env.dashboardUrl}${AGENT_ROUTE.launch}?project=1`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: `http://${origin}`,
					},
				},
			);
			assert.equal(launched.ok, true);
			await until("el lanzador simulado se ejecutó", () =>
				existsSync(join(env.dir, TERMINAL_ARGV_FILE)),
			);
			// Se para sin esperar a que la sesión simulada llegue a registrarse
			await env.stop();
			await until(
				"no queda ningún proceso del entorno",
				() => processesOf(env.dir).length === 0,
				SETTLE_MS,
			);
		} finally {
			// Si el test falla, que no deje huérfanos tras él
			for (const p of processesOf(env.dir)) {
				try {
					process.kill(p.pid, "SIGKILL");
				} catch {
					// ya había terminado
				}
			}
		}
	});

	it("una sesión lanzada se apaga sola si su entorno desaparece sin avisarla", async () => {
		const env = await startEnvironment({ agentProject: true });
		try {
			const origin = new URL(env.dashboardUrl).host;
			await fetch(`${env.dashboardUrl}${AGENT_ROUTE.launch}?project=1`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: `http://${origin}`,
				},
			});
			const pidFile = join(env.dir, "fake-claude.pid");
			await until("el lanzador dejó el pid", () => existsSync(pidFile));
			const sessionPid = Number(readFileSync(pidFile, "utf8"));
			await until("la sesión simulada vive", () =>
				processesOf(env.dir).some((p) => p.pid === sessionPid),
			);
			// El entorno se borra sin parar a nadie: la sesión debe notarlo y salir
			await rm(env.dir, { recursive: true, force: true });
			await until(
				"la sesión se apagó sola",
				() => !processesOf(env.dir).some((p) => p.pid === sessionPid),
				SETTLE_MS,
			);
		} finally {
			for (const p of processesOf(env.dir)) {
				try {
					process.kill(p.pid, "SIGKILL");
				} catch {
					// ya había terminado
				}
			}
			await env.stop().catch(() => {});
		}
	});
});
