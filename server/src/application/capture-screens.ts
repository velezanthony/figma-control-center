// figma_capture: lee y valida la configuración (sin ejecutar nada), pide
// allowPageWorld si alguna pantalla usa evaluateInPage, resuelve los secretos, toma el lock de captura de la máquina y
// captura en el Chrome de captura; cada pantalla se juzga con capture@1 y va a web-captures/ o a rejected/. Pasa por el
// flujo de jobs de siempre (plazo blando, job, aviso al acabar) pero sin la pestaña de Figma.
import { randomUUID } from "node:crypto";
import { ATTEMPT_KIND } from "#domain/attempt.ts";
import {
	CAPTURE_KIT,
	type CaptureImage,
	CONTRACT,
	type Screen,
	type ScreenCapture,
	type WebUser,
} from "#domain/capture.ts";
import { type CaptureIssue, checkCapture } from "#domain/capture-check.ts";
import {
	contractError,
	type FigmaError,
	WEB_PAGE_REASON,
	webPageError,
} from "#domain/figma-error.ts";
import { type JobId, toJobId } from "#domain/job.ts";
import { withIds } from "#domain/node-id.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { failed, type RunOutcome, succeeded } from "#domain/run-outcome.ts";
import type { BuildLock, JobRegistry } from "./job-registry.ts";
import type { ProjectConfigSource } from "./ports/project-config.ts";
import type { SecretStore } from "./ports/secrets.ts";
import type { WebCaptureStore } from "./ports/web-capture-store.ts";
import type {
	CapturedScreen,
	CaptureUser,
	WebCapturer,
} from "./ports/web-capturer.ts";
import type { AttemptRecorder } from "./record-attempt.ts";
import { withSoftDeadline } from "./with-soft-deadline.ts";

// Escala y devicePixelRatio cuando project@1 no los fija (los de un proyecto concreto van en su fichero, no aquí)
const DEFAULT_SCALE = 1;

export type CaptureReportError = {
	readonly screen: string;
	readonly code: string;
	readonly message: string;
	readonly nodeId?: string | undefined;
	readonly path?: string | undefined;
};

export type CaptureReport = {
	readonly files: readonly { readonly screen: string; readonly path: string }[];
	readonly rejected: readonly {
		readonly screen: string;
		readonly path: string;
		readonly errorsPath: string;
	}[];
	// Una línea por pantalla: variantes, nodos, imágenes y avisos. Nunca el árbol
	readonly summary: readonly string[];
	// Recortados a FCC_CONTRACT_INLINE_ERRORS; la lista entera, en el fichero de errores de cada rechazada
	readonly errors: readonly CaptureReportError[];
	readonly errorCount: number;
	readonly error: FigmaError | null;
};

export type CaptureRun =
	| { readonly kind: "usage"; readonly message: string }
	// jobId null: no llegó a empezar (la configuración o los secretos no valen)
	| {
			readonly kind: "finished";
			readonly jobId: JobId | null;
			readonly outcome: Result<CaptureReport, FigmaError>;
	  }
	| { readonly kind: "running"; readonly jobId: JobId };

export type CaptureScreensInput = {
	readonly screens: readonly string[];
	readonly allowPageWorld?: boolean | undefined;
	// La llamada de figma_capture: enlaza el intento de cada pantalla con ella en el historial
	readonly callId?: string | undefined;
};

export type CaptureScreensDeps = {
	readonly project: ProjectConfigSource;
	readonly secrets: SecretStore;
	readonly capturer: WebCapturer;
	readonly store: WebCaptureStore;
	// El lock de captura de la máquina (una a la vez: el puerto es uno)
	readonly lock: BuildLock;
	readonly jobs: JobRegistry;
	readonly softDeadlineMs: number;
	readonly pageTimeoutMs: number;
	readonly captureMaxBytes: number;
	readonly inlineErrors: number;
	// Lo que dice el esquema zod de capture@1 (vive en el borde: adapters/contracts)
	readonly checkSchema: (capture: unknown) => readonly CaptureIssue[];
	readonly clock: () => Date;
	// El historial de intentos: uno por pantalla capturada; sin él, nada se guarda
	readonly attempts?: AttemptRecorder | undefined;
	// La hora local con su desfase, como las demás fechas que ve el agente
	readonly localIso: (at: Date) => string;
	readonly now?: () => number;
	readonly onJobFinished?: (job: {
		readonly jobId: JobId;
		readonly outcome: RunOutcome;
		readonly ms: number;
	}) => void;
};

const usage = (message: string): CaptureRun => ({ kind: "usage", message });
const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;
const utf8Bytes = (text: string): number =>
	new TextEncoder().encode(text).length;

const countNodes = (nodes: readonly unknown[]): number =>
	nodes.reduce<number>((total, node) => {
		const kids = (node as { kids?: unknown } | null)?.kids;
		return total + 1 + (Array.isArray(kids) ? countNodes(kids) : 0);
	}, 0);

const usesPageWorld = (screen: Screen): boolean =>
	(screen.variants ?? []).some((v) =>
		(v.run ?? []).some((a) => "evaluateInPage" in a),
	);

export function makeCaptureScreens(deps: CaptureScreensDeps) {
	const now = deps.now ?? (() => performance.now());

	return async (input: CaptureScreensInput): Promise<CaptureRun> => {
		const loaded = await deps.project.load();
		if (!loaded.ok) return { kind: "finished", jobId: null, outcome: loaded };
		const { config, screens: file, hooks } = loaded.value;

		const known = new Map(file.screens.map((s) => [s.key, s]));
		const unknown = input.screens.filter((k) => !known.has(k));
		if (unknown.length > 0)
			return usage(
				`Pantallas que no están en el screens@1 del proyecto: ${unknown.join(", ")}. Las que hay: ${[...known.keys()].join(", ")}.`,
			);
		const screens = input.screens.map((k) => known.get(k) as Screen);

		const pageWorld = screens.filter(usesPageWorld).map((s) => s.key);
		if (pageWorld.length > 0 && input.allowPageWorld !== true)
			return usage(
				`Estas pantallas ejecutan evaluateInPage en el mundo de la página y piden allowPageWorld: true (se aprueba con la llamada): ${pageWorld.join(", ")}.`,
			);

		const users = new Map<string, WebUser>();
		for (const s of screens) {
			const user =
				s.session === undefined ? undefined : config.web.users?.[s.session];
			if (s.session !== undefined && user !== undefined)
				users.set(s.session, user);
		}
		const secrets = await deps.secrets.resolve([
			...new Set([...users.values()].map((u) => u.secretRef)),
		]);
		if (!secrets.ok) return { kind: "finished", jobId: null, outcome: secrets };
		const credentials = new Map<string, CaptureUser>(
			[...users].map(([name, u]) => [
				name,
				{
					username: u.username,
					password: secrets.value.get(u.secretRef) ?? "",
				},
			]),
		);

		const lockId = toJobId(`web-capture-${randomUUID()}`);
		if (!deps.lock.acquire(lockId)) {
			const pid = deps.lock.foreignPid?.();
			return usage(
				`Ya hay otra captura de la web en marcha en esta máquina${pid === undefined ? "" : ` (pid ${pid})`}: el Chrome de captura es uno. Espera a que acabe y vuelve a pedirla.`,
			);
		}

		const startedAt = now();
		const jobId = deps.jobs.start();
		const work = async (): Promise<Result<CaptureReport, FigmaError>> => {
			const files: { screen: string; path: string }[] = [];
			const rejected: { screen: string; path: string; errorsPath: string }[] =
				[];
			const summary: string[] = [];
			const errors: CaptureReportError[] = [];
			// Cuándo acabó la pantalla anterior (o empezó la captura): el inicio del intento de la siguiente
			let mark = deps.clock();
			const screenScale = config.web.screenScale ?? DEFAULT_SCALE;
			const devicePixelRatio = config.web.devicePixelRatio ?? DEFAULT_SCALE;

			const onScreen = async (captured: CapturedScreen): Promise<void> => {
				const screen = known.get(captured.key) as Screen;
				const at = deps.clock();
				const attempt = deps.attempts?.start({
					kind: ATTEMPT_KIND.capture,
					source: { kind: "key", key: screen.key },
					callId: input.callId,
					jobId,
					hooks:
						hooks === null ? undefined : { path: "", content: hooks.source },
					screens: { content: JSON.stringify(screen) },
					startedAt: mark,
				});
				mark = at;
				const images: Record<string, CaptureImage> = {};
				for (const image of captured.images) {
					await deps.store.saveImage(image);
					images[image.sha256] = {
						path: deps.store.imagePath(image),
						width: image.width,
						height: image.height,
						type: image.type,
					};
				}
				const variants = captured.variants.map((v) => ({
					props: v.props,
					nodes: withIds(v.nodes),
					annotations: [],
				}));
				const capture = {
					contract: CONTRACT.capture,
					screen: screen.key,
					title: screen.title,
					source: {
						url: captured.url,
						viewport: config.web.viewport,
						screenScale,
						devicePixelRatio,
						capturedAt: deps.localIso(at),
						kit: CAPTURE_KIT,
						hooks: hooks === null ? null : { sha256: hooks.sha256 },
					},
					variants,
					images,
					warnings: captured.warnings,
				};
				const json = JSON.stringify(capture);
				const schemaIssues = deps.checkSchema(capture);
				const issues =
					schemaIssues.length > 0
						? schemaIssues
						: checkCapture(capture as unknown as ScreenCapture, {
								bytes: utf8Bytes(json),
								maxBytes: deps.captureMaxBytes,
							});
				if (issues.length > 0) {
					const listed = issues.map((i) => ({ screen: screen.key, ...i }));
					const stored = await deps.store.saveRejected(
						screen.key,
						json,
						JSON.stringify(listed, null, 2),
						at,
					);
					rejected.push({ screen: screen.key, ...stored });
					errors.push(...listed);
					await attempt?.finish({
						ok: false,
						error: contractError(issues.length, stored.errorsPath),
					});
					summary.push(
						`${screen.key}: rechazada, ${plural(issues.length, "error", "errores")} de contrato`,
					);
					return;
				}
				const stored = await deps.store.saveCapture(screen.key, json, at);
				files.push({ screen: screen.key, path: stored.path });
				await attempt?.finish({ ok: true });
				const nodes = variants.reduce((n, v) => n + countNodes(v.nodes), 0);
				const warnings =
					captured.warnings.length === 0
						? ""
						: `, ${plural(captured.warnings.length, "aviso", "avisos")}`;
				summary.push(
					`${screen.key}: ${plural(variants.length, "variante", "variantes")}, ${plural(nodes, "nodo", "nodos")}, ${plural(captured.images.length, "imagen", "imágenes")}${warnings}`,
				);
			};

			const ran = await deps.capturer.capture(
				{
					web: {
						baseUrl: config.web.baseUrl,
						viewport: config.web.viewport,
						screenScale,
						devicePixelRatio,
						login: config.web.login ?? null,
						strip: config.web.strip ?? [],
						hideScrollbar: config.web.hideScrollbar ?? false,
					},
					screens,
					users: credentials,
					hooks: hooks?.source ?? null,
					allowPageWorld: input.allowPageWorld === true,
					pageTimeoutMs: deps.pageTimeoutMs,
				},
				onScreen,
			);
			const firstRejected = rejected[0];
			const error = !ran.ok
				? ran.error
				: firstRejected === undefined
					? null
					: contractError(rejected.length, firstRejected.errorsPath);
			return ok({
				files,
				rejected,
				summary,
				errors: errors.slice(0, deps.inlineErrors),
				errorCount: errors.length,
				error,
			});
		};

		const finished = work()
			.catch(
				(e: unknown): Result<CaptureReport, FigmaError> =>
					err(
						webPageError(
							WEB_PAGE_REASON.load,
							`fallo inesperado de la captura: ${e instanceof Error ? e.message : String(e)}`,
						),
					),
			)
			.then((outcome) => {
				deps.lock.release(lockId);
				const failure = outcome.ok ? outcome.value.error : outcome.error;
				const run =
					failure === null
						? succeeded(outcome.ok ? outcome.value : null, [])
						: failed(failure);
				deps.jobs.complete(jobId, run);
				deps.onJobFinished?.({ jobId, outcome: run, ms: now() - startedAt });
				return outcome;
			});
		const race = await withSoftDeadline(finished, deps.softDeadlineMs);
		return race.kind === "finished"
			? { kind: "finished", jobId, outcome: race.value }
			: { kind: "running", jobId };
	};
}
