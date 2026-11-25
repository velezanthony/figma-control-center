// El Chrome de captura: uno por llamada, sin ventana, con su puerto, un perfil temporal
// nuevo y la escala del proyecto; se mata por su pid y se borra su perfil al acabar, también si algo falla. Nunca es el
// Chrome de Figma: este módulo no conoce FIGMA_CDP_PORT. Si el puerto ya contesta, no se lanza otro encima.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import {
	type FigmaError,
	WEB_PAGE_REASON,
	webPageError,
} from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { CdpConnection, type OutgoingMessage } from "./cdp-connection.ts";
import {
	CHROME_FLAGS,
	LEGACY_PROFILE_PREFIX,
	LOOPBACK,
	POINTER_DEVICE_FLAG,
	PROFILE_PREFIX,
	TIMING,
	VERSION_PATH,
} from "./protocol.ts";

export type CaptureChromeOptions = {
	readonly bin: string;
	readonly port: number;
	readonly profileDir: string;
	// --force-device-scale-factor (la escala de pantalla del proyecto)
	readonly screenScale: number;
	readonly viewport: { readonly w: number; readonly h: number };
	// Cuánto se espera a que el Chrome conteste y cada llamada de CDP
	readonly timeoutMs: number;
	// Que el Chrome diga que tiene un ratón (`(hover: hover)` y `(pointer: fine)`): sin él, un Chrome sin cabeza no tiene puntero y
	// las reglas de `:hover` envueltas en `@media (hover: hover)` (Tailwind v4) no se aplican ni con la pseudoclase forzada
	readonly pointerDevice?: boolean | undefined;
	readonly trace?: (m: OutgoingMessage) => void;
};

export type CaptureChrome = {
	readonly pid: number;
	readonly profile: string;
	readonly cdp: CdpConnection;
	// Mata el Chrome por su pid y borra el perfil; se puede llamar más de una vez
	close(): Promise<void>;
};

// Los procesos hijos de Chrome pueden seguir escribiendo en el perfil un instante después de que acabe el principal
const RM_PROFILE = {
	recursive: true,
	force: true,
	maxRetries: 10,
	retryDelay: 100,
} as const;

const VersionSchema = z.object({
	webSocketDebuggerUrl: z.string(),
	Browser: z.string().optional(),
});

const endpoint = (port: number) => `http://${LOOPBACK}:${port}${VERSION_PATH}`;

async function version(
	port: number,
): Promise<z.infer<typeof VersionSchema> | null> {
	try {
		const res = await fetch(endpoint(port));
		const parsed = VersionSchema.safeParse(await res.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

// ¿Contesta algo en el puerto? Lo que sea (un Chrome, otro servidor): no se lanza encima
async function whoAnswers(port: number): Promise<string | null> {
	try {
		const res = await fetch(endpoint(port));
		const body = await res.text();
		const parsed = VersionSchema.safeParse(JSON.parse(body));
		return parsed.success
			? (parsed.data.Browser ?? "un Chrome con puerto de depuración")
			: `algo que responde HTTP ${res.status}`;
	} catch (e) {
		const code = (e as { cause?: { code?: string } }).cause?.code;
		return code === "ECONNREFUSED"
			? null
			: `algo que no es Chrome (${code ?? String(e)})`;
	}
}

// Perfiles de una captura que murió a medias: solo puede haber una captura a la vez en la máquina (lock), así que todo
// lo que tiene el prefijo al empezar es huérfano
export async function sweepOrphanProfiles(profileDir: string): Promise<number> {
	let names: string[];
	try {
		names = await readdir(profileDir);
	} catch {
		return 0;
	}
	const orphans = names.filter(
		(n) => n.startsWith(PROFILE_PREFIX) || n.startsWith(LEGACY_PROFILE_PREFIX),
	);
	await Promise.all(orphans.map((n) => rm(join(profileDir, n), RM_PROFILE)));
	return orphans.length;
}

async function kill(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((r) => child.once("exit", r));
	child.kill("SIGTERM");
	await Promise.race([exited, sleep(TIMING.killGraceMs)]);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await exited;
	}
}

export async function launchCaptureChrome(
	options: CaptureChromeOptions,
): Promise<Result<CaptureChrome, FigmaError>> {
	const busy = await whoAnswers(options.port);
	if (busy !== null)
		return err(
			webPageError(
				WEB_PAGE_REASON.chrome,
				`el puerto ${options.port} ya contesta (${busy}): no se lanza otro Chrome encima`,
			),
		);
	await mkdir(options.profileDir, { recursive: true });
	await sweepOrphanProfiles(options.profileDir);
	const profile = await mkdtemp(join(options.profileDir, PROFILE_PREFIX));
	const child = spawn(
		options.bin,
		[
			...CHROME_FLAGS,
			...(options.pointerDevice === true ? [POINTER_DEVICE_FLAG] : []),
			`--remote-debugging-port=${options.port}`,
			`--user-data-dir=${profile}`,
			`--force-device-scale-factor=${options.screenScale}`,
			`--window-size=${options.viewport.w},${options.viewport.h}`,
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	const spawnError = new Promise<Error>((r) => child.once("error", r));
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		await kill(child);
		await rm(profile, RM_PROFILE);
	};
	const fail = async (detail: string) => {
		await close();
		return err(webPageError(WEB_PAGE_REASON.chrome, detail));
	};
	const deadline = Date.now() + options.timeoutMs;
	let info: z.infer<typeof VersionSchema> | null = null;
	while (info === null && Date.now() < deadline) {
		const failed = await Promise.race([
			spawnError,
			sleep(TIMING.startPollMs).then(() => null),
		]);
		if (failed !== null)
			return fail(`no se pudo lanzar ${options.bin}: ${failed.message}`);
		if (child.exitCode !== null || child.signalCode !== null)
			return fail(
				`${options.bin} terminó al arrancar (${child.exitCode === null ? `señal ${child.signalCode}` : `código ${child.exitCode}`})`,
			);
		info = await version(options.port);
	}
	if (info === null)
		return fail(
			`${options.bin} no contestó en el puerto ${options.port} en ${options.timeoutMs} ms`,
		);
	try {
		const cdp = await CdpConnection.open(
			info.webSocketDebuggerUrl,
			options.timeoutMs,
			options.trace,
		);
		return ok({
			pid: child.pid as number,
			profile,
			cdp,
			close: async () => {
				cdp.close();
				await close();
			},
		});
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}
}
