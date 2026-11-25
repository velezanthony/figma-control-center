// E13 (servidor) — permisos desde el panel: el Claude simulado abre un diálogo de permiso (relevo del channel), el
// panel lo ve por la API, lo contesta una vez y el veredicto vuelve a Claude Code. Procesos reales (MCP + panel + SQLite).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";
import { liveSessionId } from "../../harness/seed-chat.ts";
import { until } from "../../harness/wait.ts";

type Item = { id: number; requestId: string; status: string; toolName: string };

let env: Environment;
let claude: FakeClaudeCode;
let session: string;

const list = async () =>
	(await env.api<{ items: Item[] }>(`/api/chat/permissions?session=${session}`))
		.items;

const decide = (id: number, behavior: string, origin = env.dashboardUrl) =>
	fetch(`${env.dashboardUrl}/api/chat/permissions`, {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify({ sessionId: session, id, behavior }),
	});

async function ask(toolName = "Bash") {
	const requestId = await claude.askPermission({
		toolName,
		description: "Run shell command",
		inputPreview: '{"command":"ls <b>-la</b>"}',
	});
	await until("el panel ve la petición", async () =>
		(await list()).some((r) => r.requestId === requestId),
	);
	const item = (await list()).find((r) => r.requestId === requestId);
	assert.ok(item);
	return item;
}

before(async () => {
	env = await startEnvironment({ chatAgent: true });
	claude = await env.startClaude({ reply: null });
	await until("la sesión publica su chat", () => {
		try {
			session = liveSessionId(env);
			return true;
		} catch {
			return false;
		}
	});
});
after(async () => {
	await env?.stop();
});

describe("E13 · permisos desde el panel", () => {
	it("la petición aparece pendiente con su herramienta y, al aprobarla, Claude Code recibe allow con su id", async () => {
		const item = await ask();
		assert.equal(item.status, "pending");
		assert.equal(item.toolName, "Bash");
		assert.equal((await decide(item.id, "allow")).status, 200);
		await until(
			"Claude Code recibe el veredicto",
			() => claude.verdicts.length === 1,
		);
		assert.deepEqual(claude.verdicts[0], {
			requestId: item.requestId,
			behavior: "allow",
		});
		assert.equal(
			(await list()).find((r) => r.id === item.id)?.status,
			"allowed",
		);
	});

	it("denegar devuelve deny", async () => {
		const before = claude.verdicts.length;
		const item = await ask("Write");
		assert.equal((await decide(item.id, "deny")).status, 200);
		await until(
			"llega el veredicto",
			() => claude.verdicts.length === before + 1,
		);
		assert.equal(claude.verdicts.at(-1)?.behavior, "deny");
	});

	it("solo se contesta una vez: la segunda respuesta es 409 y Claude Code no recibe otro veredicto", async () => {
		const before = claude.verdicts.length;
		const item = await ask();
		assert.equal((await decide(item.id, "allow")).status, 200);
		assert.equal((await decide(item.id, "deny")).status, 409);
		await until(
			"llega el primero",
			() => claude.verdicts.length === before + 1,
		);
		await new Promise((r) => setTimeout(r, 400));
		assert.equal(claude.verdicts.length, before + 1);
		assert.equal(claude.verdicts.at(-1)?.behavior, "allow");
	});

	it("si la terminal contestó antes, el veredicto del panel lo descarta Claude Code y nada se rompe", async () => {
		const item = await ask();
		claude.answerInTerminal(item.requestId);
		assert.equal((await decide(item.id, "allow")).status, 200);
		await until("Claude Code lo descarta", () =>
			claude.droppedVerdicts.some((v) => v.requestId === item.requestId),
		);
		assert.ok(!claude.verdicts.some((v) => v.requestId === item.requestId));
	});

	it("un origen ajeno no puede contestar", async () => {
		const item = await ask();
		assert.equal(
			(await decide(item.id, "allow", "https://malo.example")).status,
			403,
		);
		assert.equal(
			(await list()).find((r) => r.id === item.id)?.status,
			"pending",
		);
	});

	it("una decisión escrita en la base sin la firma de la sesión no llega a Claude Code", async () => {
		const item = await ask();
		const before = claude.verdicts.length;
		env.exec(
			`UPDATE permission_requests SET status = 'allowed', decided_at = ${Date.now()}, decider_hash = 'falsa' WHERE id = ${item.id}`,
		);
		await until(
			"queda rechazada",
			() =>
				env.rows(
					`SELECT 1 FROM permission_requests WHERE id = ${item.id} AND status = 'rejected'`,
				).length === 1,
		);
		assert.equal(claude.verdicts.length, before);
		assert.ok(!(await list()).some((r) => r.id === item.id));
	});

	it("el Claude simulado no vio ninguna violación del contrato", () => {
		assert.deepEqual(claude.violations, []);
	});
});
