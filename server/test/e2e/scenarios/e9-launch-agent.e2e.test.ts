// E9 (servidor) — «Lanzar agente»: POST del panel → lanzador simulado → make agent → agent-run.ts → claude falso → una
// sesión nueva con chat aparece; si el lanzador no crea ninguna, el panel sigue bloqueando el reintento hasta el plazo.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import {
	AGENT_DIR_ARG,
	LAUNCH_ARGV_TAIL,
	LaunchedSchema,
} from "../../contracts/launch.ts";
import {
	startEnvironment,
	TERMINAL_ARGV_FILE,
} from "../../harness/environment.ts";
import { until } from "../../harness/wait.ts";

// La respuesta del panel al lanzar: ok + el contrato de lanzamiento
const AgentLaunchedSchema = LaunchedSchema.extend({ ok: z.literal(true) });

const launch = (dashboardUrl: string, project?: string) =>
	fetch(
		`${dashboardUrl}/api/agent/launch${project === undefined ? "" : `?project=${project}`}`,
		{
			method: "POST",
			headers: { Origin: dashboardUrl, "Content-Type": "application/json" },
		},
	);

type Sessions = { items: { sessionId: string; alive: boolean }[] };

describe("E9 · lanzar agente", () => {
	it("el lanzamiento responde con su plazo y la sesión nueva aparece sola con chat", async () => {
		const env = await startEnvironment({ agentProject: true });
		try {
			const before = await env.api<Sessions>("/api/chat/sessions?project=1");
			assert.equal(before.items.length, 0);
			const r = await launch(env.dashboardUrl, "1");
			assert.equal(r.status, 202);
			const body = (await r.json()) as { ok: boolean };
			assert.equal(AgentLaunchedSchema.safeParse(body).success, true);
			await until("la sesión lanzada publica su chat", async () => {
				const s = await env.api<Sessions>("/api/chat/sessions?project=1");
				return s.items.some((i) => i.alive);
			});
		} finally {
			await env.stop();
		}
	});

	it("el panel lanza `make agent PROJECT=<id> AGENT_DIR=<carpeta>`", async () => {
		const env = await startEnvironment({ agentProject: true });
		try {
			assert.equal((await launch(env.dashboardUrl, "1")).status, 202);
			const argvFile = join(env.dir, TERMINAL_ARGV_FILE);
			await until("el lanzador deja escritos sus argumentos", () =>
				existsSync(argvFile),
			);
			const argv = JSON.parse(readFileSync(argvFile, "utf8")) as string[];
			assert.deepEqual(argv.slice(-4, -1), [...LAUNCH_ARGV_TAIL, "PROJECT=1"]);
			assert.match(argv.at(-1) ?? "", AGENT_DIR_ARG);
		} finally {
			await env.stop();
		}
	});

	it("un proyecto que no existe no lanza nada (404)", async () => {
		const env = await startEnvironment({ launcher: "does-nothing" });
		try {
			assert.equal((await launch(env.dashboardUrl, "99")).status, 404);
		} finally {
			await env.stop();
		}
	});

	it("si el lanzador no crea ninguna sesión, un segundo intento inmediato se rechaza (409) y tras el plazo se permite", async () => {
		const env = await startEnvironment({
			agentProject: true,
			launcher: "does-nothing",
			extraEnv: { FCC_AGENT_LAUNCH_TIMEOUT_MS: "400" },
		});
		try {
			assert.equal((await launch(env.dashboardUrl, "1")).status, 202);
			const second = await launch(env.dashboardUrl, "1");
			assert.equal(second.status, 409);
			assert.equal(
				((await second.json()) as { error: { type: string } }).error.type,
				"LaunchInProgress",
			);
			await until(
				"vence el plazo del lanzamiento",
				async () => (await launch(env.dashboardUrl, "1")).status === 202,
			);
		} finally {
			await env.stop();
		}
	});
});
