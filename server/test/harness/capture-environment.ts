// El entorno de los escenarios de la captura de la web (E57-E61): servidor MCP real con el proyecto `example-mini`, su
// web servida en local y el Chromium de Playwright como Chrome de captura (FCC_WEB_CHROME_BIN, en un puerto libre).
// Sin el proyecto consumidor, sin Figma de verdad y sin el 9222.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureChromeBin } from "./capture-chrome-bin.ts";
import { type Environment, FILE_URL, startEnvironment } from "./environment.ts";
import {
	EXAMPLE_MINI_PASSWORD,
	EXAMPLE_MINI_SECRET_REF,
	type ExampleMini,
	exampleMiniProject,
	startExampleMini,
	writeSecrets,
} from "./example-mini.ts";
import type { FakeClaudeCode } from "./fake-claude.ts";

// La captura tarda más que el plazo blando de las pruebas: con este, responde ya terminada
const SOFT_DEADLINE_MS = 30_000;
const PAGE_TIMEOUT_MS = 8000;
export const SECRETS_FILE = "secretos.json";
export const PROFILES_DIR = "perfiles-captura";

async function freePort(): Promise<number> {
	const s = createServer();
	await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
	const { port } = s.address() as AddressInfo;
	await new Promise((r) => s.close(r));
	return port;
}

export type CaptureEnvironment = {
	readonly env: Environment;
	readonly claude: FakeClaudeCode;
	readonly web: ExampleMini;
	// La carpeta de salida del proyecto (web-captures/ cuelga de aquí)
	readonly outputDir: string;
	readonly chromePort: number;
	stop(): Promise<void>;
};

export async function startCaptureEnvironment(
	options: {
		// Los secretos del fichero de la máquina (por defecto, la contraseña buena; null: sin fichero)
		readonly secrets?: Readonly<Record<string, string>> | null;
		readonly extraEnv?: Readonly<Record<string, string>>;
		// Sin proyecto dado de alta
		readonly noProject?: boolean;
		// La carpeta del proyecto es también su raíz de scripts (assets, manifiestos)
		readonly projectIsScriptsRoot?: boolean;
	} = {},
): Promise<CaptureEnvironment> {
	const web = await startExampleMini();
	const work = await mkdtemp(join(tmpdir(), "example-mini-"));
	const bin = await captureChromeBin(work);
	const chromePort = await freePort();
	const project = await exampleMiniProject(
		join(work, "proyecto"),
		web.url,
		FILE_URL,
	);
	const secrets =
		options.secrets === undefined
			? { [EXAMPLE_MINI_SECRET_REF]: EXAMPLE_MINI_PASSWORD }
			: options.secrets;
	const env = await startEnvironment({
		dashboard: false,
		projects:
			options.noProject === true
				? []
				: [
						options.projectIsScriptsRoot === true
							? { ...project, scriptsRoots: [project.projectDir] }
							: project,
					],
		extraEnv: {
			FCC_WEB_CHROME_BIN: bin,
			FCC_WEB_CHROME_PORT: String(chromePort),
			FCC_SOFT_DEADLINE_MS: String(SOFT_DEADLINE_MS),
			FCC_WEB_PAGE_TIMEOUT_MS: String(PAGE_TIMEOUT_MS),
			...options.extraEnv,
		},
		prepareDir: async (dir) => {
			if (secrets !== null)
				await writeSecrets(join(dir, SECRETS_FILE), secrets);
		},
	});
	const claude = await env.startClaude({ reply: null });
	const id = env.projects[0]?.id ?? "1";
	return {
		env,
		claude,
		web,
		outputDir: join(env.dir, "salida", id),
		chromePort,
		stop: async () => {
			await env.stop();
			await web.close();
			await rm(work, { recursive: true, force: true });
		},
	};
}
