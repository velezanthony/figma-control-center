// E49-E50: el agente lanzado desde el panel se cierra cuando se cierra el panel, y aguanta un
// reinicio rápido. La cadena es la de producción (make → agent-run.ts → claude → servidor MCP) con el lanzador simulado
// y el `claude` FALSO: nunca un Claude Code real. El cierre va por señales del sistema: nada por el canal (CA-5).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { until } from "../../harness/wait.ts";

// Margen y reintento cortos: la prueba no espera los 10 s de verdad
const WATCH_ENV = {
	FCC_AGENT_PANEL_GRACE_MS: "800",
	FCC_AGENT_WATCH_RETRY_MS: "50",
} as const;
// Un reinicio del panel (arranque, migración, montar proyectos) tarda más que el margen corto de E49: E50 da un margen
// con holgura para que el panel vuelva dentro
const RESTART_GRACE_MS = 5000;
const NO_TRAFFIC = { channelMessages: 0, toolCalls: ["figma_status"] };

const launchDirs = (env: Environment) =>
	readdirSync(join(env.dir, "tmp")).filter((n) => n.startsWith("figma-agent-"));

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const watching = async (env: Environment): Promise<string[]> => {
	const r = await env.api<{ items: { launchId: string }[] }>(
		"/api/agent/launches?project=1",
	);
	return r.items.map((i) => i.launchId);
};

// Lanza el agente desde el panel y espera a que su sesión esté conectada y vigilando al panel
async function launchAgent(env: Environment): Promise<string> {
	const r = await fetch(`${env.dashboardUrl}/api/agent/launch?project=1`, {
		method: "POST",
		headers: {
			Origin: env.dashboardUrl,
			"Content-Type": "application/json",
		},
	});
	assert.equal(r.status, 202);
	const { launchId } = (await r.json()) as { launchId: string };
	await until(
		"la sesión simulada conecta",
		() => env.fakeClaude.traffic() !== null,
	);
	await until("el agente vigila al panel", async () =>
		(await watching(env)).includes(launchId),
	);
	return launchId;
}

describe("E49 · cerrar el panel cierra el agente", () => {
	for (const signal of ["SIGKILL", "SIGTERM"] as const) {
		it(`con el panel parado por ${signal} y sin volver, claude recibe SIGTERM, la carpeta desaparece y no pasa nada por el canal`, async () => {
			const env = await startEnvironment({
				agentProject: true,
				extraEnv: WATCH_ENV,
			});
			try {
				await launchAgent(env);
				const pid = env.fakeClaude.record()?.pid as number;
				await env.killDashboard(signal);
				await until("claude ha terminado", () => !isAlive(pid));
				assert.deepEqual(env.fakeClaude.signals(), ["SIGTERM"]);
				await until(
					"la carpeta del lanzamiento desaparece",
					() => launchDirs(env).length === 0,
				);
				assert.deepEqual(launchDirs(env), []);
				assert.deepEqual(env.fakeClaude.traffic(), NO_TRAFFIC);
			} finally {
				await env.stop();
			}
		});
	}
});

describe("E50 · reiniciar el panel dentro del margen", () => {
	it("el agente sigue vivo y su vigilancia vuelve a abrirse", async () => {
		const env = await startEnvironment({
			agentProject: true,
			extraEnv: {
				...WATCH_ENV,
				FCC_AGENT_PANEL_GRACE_MS: String(RESTART_GRACE_MS),
			},
		});
		try {
			const launchId = await launchAgent(env);
			const pid = env.fakeClaude.record()?.pid as number;
			const killedAt = Date.now();
			await env.killDashboard("SIGKILL");
			await env.restartDashboard();
			await until("el agente vuelve a vigilar al panel", async () =>
				(await watching(env)).includes(launchId),
			);
			// Pasado de largo el margen que empezó al morir el panel, sigue vivo
			const left = killedAt + RESTART_GRACE_MS + 500 - Date.now();
			await new Promise((r) => setTimeout(r, Math.max(0, left)));
			assert.equal(isAlive(pid), true);
			assert.deepEqual(env.fakeClaude.signals(), []);
			assert.equal(launchDirs(env).length, 1);
			assert.deepEqual(env.fakeClaude.traffic(), NO_TRAFFIC);
		} finally {
			await env.stop();
		}
	});
});
