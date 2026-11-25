// E13 permisos desde el panel en el navegador: el Claude simulado abre un diálogo de permiso, la tarjeta aparece en la
// conversación, se contesta con ratón o con teclado, y lo que trae la herramienta se muestra como texto.
import { until } from "../../harness/wait.ts";
import { expect, test } from "./fixtures.ts";

const HOSTILE_INPUT = `{"command":"echo <img src=x onerror=window.__pwned=1> && rm -rf /"}`;

test("E13 · la petición aparece, se aprueba con el ratón y Claude Code recibe allow; la entrada se ve como texto", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ chatAgent: true, reply: null });
	const claude = await env.startClaude();
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await expect(
		page.getByRole("textbox", { name: "Mensaje para Claude" }),
	).toBeEnabled();

	const requestId = await claude.askPermission({
		toolName: "Bash",
		description: "Lista los archivos",
		inputPreview: HOSTILE_INPUT,
	});
	const card = page.getByRole("article", {
		name: "Claude pide permiso para usar Bash",
	});
	await expect(card).toBeVisible();
	await expect(card.getByText("Esperando tu respuesta")).toBeVisible();
	await expect(card.getByText("Lista los archivos")).toBeVisible();

	// Dato, no HTML: la etiqueta se ve literal y no existe como elemento ni ejecuta nada
	await expect(card.getByText("<img src=x", { exact: false })).toBeVisible();
	await expect(card.locator("img")).toHaveCount(0);
	expect(await page.evaluate(() => "__pwned" in globalThis)).toBe(false);

	await card.getByRole("button", { name: "Aprobar" }).click();
	await expect(card.getByText("Aprobada")).toBeVisible();
	await expect(card.getByRole("button", { name: "Aprobar" })).toHaveCount(0);
	// El foco no cae a la página al desaparecer los botones
	await expect(card).toBeFocused();

	await until(
		"Claude Code recibe el veredicto",
		() => claude.verdicts.length === 1,
	);
	expect(claude.verdicts[0]).toEqual({ requestId, behavior: "allow" });
	expect(claude.violations).toEqual([]);
});

test("E13 · denegar con el teclado y la segunda petición queda independiente", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ chatAgent: true, reply: null });
	const claude = await env.startClaude();
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await expect(
		page.getByRole("textbox", { name: "Mensaje para Claude" }),
	).toBeEnabled();

	const first = await claude.askPermission({
		toolName: "Write",
		description: "Escribe un archivo",
		inputPreview: '{"file_path":"/tmp/x"}',
	});
	const second = await claude.askPermission({
		toolName: "Edit",
		description: "Modifica un archivo",
		inputPreview: '{"file_path":"/tmp/y"}',
	});
	const writeCard = page.getByRole("article", {
		name: "Claude pide permiso para usar Write",
	});
	const editCard = page.getByRole("article", {
		name: "Claude pide permiso para usar Edit",
	});
	await expect(writeCard).toBeVisible();
	await expect(editCard).toBeVisible();

	// Teclado: el botón se alcanza con el foco y se acciona con Intro
	const deny = writeCard.getByRole("button", { name: "Denegar" });
	await deny.focus();
	await expect(deny).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(writeCard.getByText("Denegada")).toBeVisible();
	await expect(editCard.getByText("Esperando tu respuesta")).toBeVisible();

	await until(
		"llega el veredicto de la primera",
		() => claude.verdicts.length === 1,
	);
	expect(claude.verdicts[0]).toEqual({ requestId: first, behavior: "deny" });
	expect(claude.verdicts.some((v) => v.requestId === second)).toBe(false);
});

test("E13 · si el panel se abre después, la petición pendiente ya está ahí", async ({
	page,
	makeEnv,
}) => {
	const env = await makeEnv({ chatAgent: true, reply: null });
	const claude = await env.startClaude();
	await claude.askPermission({
		toolName: "Bash",
		description: "Antes de abrir el panel",
		inputPreview: "{}",
	});
	await until(
		"queda guardada",
		() => env.rows("SELECT 1 FROM permission_requests").length === 1,
	);
	await page.goto(`${env.dashboardUrl}/#/chat`);
	await expect(
		page.getByRole("article", { name: "Claude pide permiso para usar Bash" }),
	).toBeVisible();
});
