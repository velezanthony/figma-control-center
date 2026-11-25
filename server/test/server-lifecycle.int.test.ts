// El servidor MCP no debe quedar huérfano: cuando su cliente (Claude Code) cierra la tubería (EOF en stdin),
// tiene que apagarse solo. Un agente de chat tiene un sondeo (setInterval) que, sin este arreglo, lo mantenía vivo.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { e2eProject, FIGMA_DB_FILE, testEnv } from "./harness/env.ts";
import { addProjects } from "./harness/projects.ts";

const MAIN = join(import.meta.dirname, "../src/main.ts");
const EXIT_DEADLINE_MS = 5000;
// Cerrar stdin durante el arranque: el servidor lo nota al terminar de arrancar (nadie lee stdin antes), y con la
// máquina cargada por otros tests ese arranque tarda más
const STARTUP_EXIT_DEADLINE_MS = 30_000;

const FILE_URL = "https://www.figma.com/design/abc/Archivo";

// El proyecto sale del registro (D-1): se da de alta en la base única del entorno de prueba (sin ninguno si se pide)
const startEnv = async (dir: string, withProject = true) => {
	const env = {
		...(process.env as Record<string, string>),
		...testEnv({
			dir,
			cdpPort: 59_999, // nadie escucha; el servidor arranca igual (la conexión CDP es perezosa)
			scriptsRoot: dir,
			dashboardPort: 59_998,
			agentTerminal: "terminal-de-prueba --",
			// Agente de chat (de un proyecto, como `make agent`): es el que tenía el sondeo que lo mantenía vivo
			extra: { FCC_CHAT_AGENT: "1", FCC_PROJECTS: "1" },
		}),
	};
	if (withProject) {
		await addProjects(join(dir, FIGMA_DB_FILE), join(dir, "salida"), [
			e2eProject(dir, FILE_URL),
		]);
	}
	return env;
};

async function expectsExit(
	child: ReturnType<typeof spawn>,
	deadlineMs: number = EXIT_DEADLINE_MS,
): Promise<void> {
	const exit = once(child, "exit") as Promise<[number | null]>;
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(
			() => reject(new Error("el servidor no se apagó: quedó huérfano")),
			deadlineMs,
		),
	);
	const [code] = await Promise.race([exit, timeout]);
	assert.equal(code, 0);
}

async function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
	let out = "";
	for await (const chunk of child.stderr ?? []) {
		out += String(chunk);
		if (out.includes("listo")) return;
	}
	throw new Error(`el servidor salió sin estar listo:\n${out}`);
}

test("el servidor MCP de un agente de chat se apaga solo al cerrarse su stdin (no queda huérfano)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "figma-orphan-"));
	const child = spawn(process.execPath, [MAIN], {
		env: await startEnv(dir),
		stdio: ["pipe", "ignore", "pipe"],
	});
	try {
		await waitForReady(child);
		// El cliente se va: se cierra el stdin del servidor
		child.stdin?.end();
		const exit = once(child, "exit") as Promise<[number | null]>;
		const timeout = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error("el servidor no se apagó: quedó huérfano")),
				EXIT_DEADLINE_MS,
			),
		);
		const [code] = await Promise.race([exit, timeout]);
		assert.equal(code, 0);
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
		rmSync(dir, { recursive: true, force: true });
	}
});

test("si stdin se cierra durante el arranque, el servidor también se apaga", async () => {
	const dir = mkdtempSync(join(tmpdir(), "figma-orphan-"));
	const child = spawn(process.execPath, [MAIN], {
		env: await startEnv(dir),
		stdio: ["pipe", "ignore", "pipe"],
	});
	try {
		// El cliente se va antes de que el servidor termine de arrancar (no se espera a «listo»)
		child.stdin?.end();
		await expectsExit(child, STARTUP_EXIT_DEADLINE_MS);
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
		rmSync(dir, { recursive: true, force: true });
	}
});

// Arranca con el registro dado y espera a «listo»; devuelve lo que el servidor escribió por stderr hasta entonces
async function startedErr(child: ReturnType<typeof spawn>): Promise<string> {
	let out = "";
	for await (const chunk of child.stderr ?? []) {
		out += String(chunk);
		if (out.includes("listo")) return out;
	}
	throw new Error(`el servidor salió sin estar listo:\n${out}`);
}

test("con el registro de proyectos roto el servidor arranca igual y avisa con la ruta y qué hacer", async () => {
	const dir = mkdtempSync(join(tmpdir(), "figma-registro-"));
	const env = await startEnv(dir, false);
	const registryPath = join(dir, FIGMA_DB_FILE);
	writeFileSync(registryPath, "esto no es una base SQLite");
	const child = spawn(process.execPath, [MAIN], {
		env,
		stdio: ["pipe", "ignore", "pipe"],
	});
	try {
		const err = await startedErr(child);
		assert.match(err, /registro de proyectos/);
		assert.ok(err.includes(registryPath));
		assert.match(err, /No hay ningún proyecto/);
		assert.match(err, /Proyectos/);
		assert.doesNotMatch(
			err,
			/FIGMA_FILE_URL es obligatoria|define FIGMA_FILE_URL/,
		);
	} finally {
		child.stdin?.end();
		if (child.exitCode === null) child.kill("SIGKILL");
		rmSync(dir, { recursive: true, force: true });
	}
});

test("con FIGMA_FILE_URL en el entorno el servidor avisa de que ya no se usa y no crea ningún proyecto", async () => {
	const dir = mkdtempSync(join(tmpdir(), "figma-aviso-"));
	const child = spawn(process.execPath, [MAIN], {
		env: {
			...(await startEnv(dir, false)),
			FIGMA_FILE_URL: FILE_URL,
		},
		stdio: ["pipe", "ignore", "pipe"],
	});
	try {
		const err = await startedErr(child);
		assert.match(err, /FIGMA_FILE_URL ya no se usa/);
		assert.doesNotMatch(err, /Base SQLite/);
		assert.match(err, /No hay ningún proyecto/);
	} finally {
		child.stdin?.end();
		if (child.exitCode === null) child.kill("SIGKILL");
		rmSync(dir, { recursive: true, force: true });
	}
});
