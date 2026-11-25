// E9 en el navegador: «Lanzar agente» → lanzador simulado → la sesión aparece y se selecciona sola; si expira, error con reintento
import { until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

// El lanzamiento encadena procesos (panel → lanzador → Claude simulado → servidor MCP) y la web mira las sesiones cada 2 s
const LAUNCH_CHAIN_TIMEOUT_MS = 40_000;
// Lo que el panel dice del agente del chat donde se lanza y donde se usa
const CHAT_AGENT_ROLE =
	"Este agente solo responde preguntas sobre el estado y la actividad del proyecto. Capturar, pintar o construir se hace desde Claude Code en tu proyecto.";

test("E9 · lanzar el agente: la sesión aparece y se selecciona sola", async ({
	page,
	makeEnv,
}) => {
	// El plazo del lanzamiento cubre la cadena de procesos aunque la máquina esté cargada
	const env = await makeEnv({
		agentProject: true,
		extraEnv: {
			FCC_AGENT_LAUNCH_TIMEOUT_MS: String(LAUNCH_CHAIN_TIMEOUT_MS),
		},
	});
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await expect(page.getByText("Ninguna sesión está escuchando")).toBeVisible();

	await page.getByRole("button", { name: "Lanzar agente" }).click();
	await expect(page.getByText("Sesión de las", { exact: false })).toBeVisible({
		timeout: LAUNCH_CHAIN_TIMEOUT_MS,
	});
	await expect(
		page.getByRole("textbox", { name: "Mensaje para Claude" }),
	).toBeEnabled();
	await expect(page.getByText(CHAT_AGENT_ROLE)).toBeVisible();
	await expect(page).toHaveURL(/[?&]session=/, {
		timeout: LAUNCH_CHAIN_TIMEOUT_MS,
	});
});

test("E9 · una sesión muerta en el histórico no oculta el botón de lanzar", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv();
	// Sesión con chat pero sin proceso vivo (pid NULL): aparece en sessions() por su chat_token_hash,
	// pero no es un agente escuchando. El panel debe ofrecer lanzar, no abrir su hilo muerto.
	env.exec(
		"INSERT INTO sessions(project_id, id, started_at, last_seen_at, pid, chat_token_hash) VALUES (1, 'muerta', 1, 1, NULL, 'deadbeef')",
	);
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await expect(page.getByText("Ninguna sesión está escuchando")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Lanzar agente" }),
	).toBeVisible();
	await expect(page.getByText(CHAT_AGENT_ROLE)).toBeVisible();
});

test("E9 · con la sesión viva pero estancada, se puede lanzar otro agente desde el chat", async ({
	page,
	makeEnv,
}) => {
	// Sesión viva y registrada (marca puesta) que NO contesta: un «zombie». El chat debe dejar relanzar.
	const env = await makeEnv({ chatAgent: true, reply: null });
	await env.startClaude();
	await until(
		"la sesión se registra como chat",
		() =>
			env.rows("SELECT 1 FROM sessions WHERE chat_token_hash IS NOT NULL")
				.length > 0,
	);
	const sid = env.rows<{ id: string }>(
		"SELECT id FROM sessions WHERE chat_token_hash IS NOT NULL",
	)[0]?.id;
	// Mensaje entregado hace 10 min (estancado) para no esperar el plazo real
	const old = Date.now() - 10 * 60_000;
	env.exec(
		`INSERT INTO chat_messages(project_id, session_id, direction, chat_id, body, at, status, sender_hash) VALUES (1, '${sid}', 'in', 'c1', 'hola', ${old}, 'delivered', NULL)`,
	);
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await expect(
		page.getByText("Puede que no haya ningún agente", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Lanzar agente" }),
	).toBeEnabled();
});

test("E9 · un claude normal (sin la marca de agente) conecta el MCP pero no cuenta como chat: sale el botón", async ({
	page,
	makeEnv,
}) => {
	// Sesión viva pero SIN FCC_CHAT_AGENT: conecta el MCP, no se registra como agente de chat
	const env = await makeEnv({ extraEnv: { FCC_CHAT_AGENT: "0" } });
	await env.startClaude();
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await expect(page.getByText("Ninguna sesión está escuchando")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Lanzar agente" }),
	).toBeVisible();
});

test("E9 · si la sesión no aparece a tiempo, el panel lo dice y deja reintentar", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({
		agentProject: true,
		launcher: "does-nothing",
		extraEnv: { FCC_AGENT_LAUNCH_TIMEOUT_MS: "2500" },
	});
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await page.getByRole("button", { name: "Lanzar agente" }).click();
	await expect(page.getByText("Lanzando agente…").first()).toBeVisible();

	await expect(page.getByRole("alert")).toContainText(
		"La sesión no ha aparecido a tiempo",
	);
	const retry = page.getByRole("button", { name: "Reintentar" });
	await expect(retry).toBeVisible();
	await retry.click();
	await expect(page.getByText("Lanzando agente…").first()).toBeVisible();
});

test("E41 · un proyecto con raíces peligrosas: el chat y el Inicio dicen cuál y que se revisen en «Proyectos»", async ({
	page,
	makeEnv,
}) => {
	// El proyecto de siempre usa los scripts de los escenarios, dentro del repo: el arnés no lo deja lanzar
	const env = await makeEnv();
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await page.getByRole("button", { name: "Lanzar agente" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"No se puede lanzar el agente",
	);
	await expect(page.getByRole("alert")).toContainText("«Proyectos»");

	await page.goto(`${env.dashboardUrl}/#/`);
	await page.getByRole("button", { name: "Lanzar agente" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"por defecto de la máquina",
	);
	await expect(page.getByRole("alert")).toContainText("«Proyectos»");
});
