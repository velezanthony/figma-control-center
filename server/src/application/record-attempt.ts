// Historial de intentos: cada ejecución de un script guarda el contenido exacto de lo que usó,
// enlazado a su llamada y a su paso. Registrar es accesorio: un fallo se avisa y nunca rompe la herramienta.
import {
	ATTEMPT_KIND,
	ATTEMPT_ROLE,
	ATTEMPT_STATUS,
	type AttemptKind,
	type AttemptStatus,
	CODE_TARGET,
} from "#domain/attempt.ts";
import {
	FIGMA_ERROR_TYPE,
	type FigmaError,
	WEB_ERROR_TYPE,
} from "#domain/figma-error.ts";
import type { AssetRepository } from "./ports/asset-repository.ts";
import type { AttemptContent, AttemptLog } from "./ports/attempt-log.ts";
import type { ScriptRepository } from "./ports/script-repository.ts";

export type KitInfo = { readonly version: string; readonly content: string };

// De dónde sale el objetivo: un fichero (se identifica por su ruta relativa a su raíz de scripts), un `code` suelto o la
// clave de una pantalla
export type AttemptSource =
	| { readonly kind: "file"; readonly path: string }
	| { readonly kind: "code" }
	| { readonly kind: "key"; readonly key: string };

export type AttemptStart = {
	readonly kind: AttemptKind;
	readonly source: AttemptSource;
	readonly callId?: string | undefined;
	readonly jobId?: string | undefined;
	readonly stepIndex?: number | undefined;
	// El contenido exacto del script (no lo lleva una captura)
	readonly step?: string | undefined;
	// Los params ya mezclados (paso > manifiesto > llamada); sin ellos no hay papel `params`
	readonly params?: unknown;
	// nombre → ruta de cada asset (se describen, no se copian)
	readonly assets?: Readonly<Record<string, string>> | undefined;
	readonly hooks?:
		| { readonly path: string; readonly content: string }
		| undefined;
	readonly screens?: { readonly content: string } | undefined;
	// F4: el plan de la pantalla (su texto), el map.json y el módulo de reconocimiento que usó el paso
	readonly plan?: { readonly content: string } | undefined;
	readonly map?:
		| { readonly path: string; readonly content: string }
		| undefined;
	readonly recognize?:
		| { readonly path: string; readonly content: string }
		| undefined;
	// Hojas de componentes: el sheets.json que usó el paso
	readonly sheets?:
		| { readonly path: string; readonly content: string }
		| undefined;
	// Cuándo empezó, si no es ahora (una captura sabe cuándo acabó la pantalla anterior)
	readonly startedAt?: Date | undefined;
};

export type AttemptOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: FigmaError };

export type AttemptRun = {
	// `jobId` solo si se supo después de empezar (un script lento que acabó siendo un job)
	finish(
		outcome: AttemptOutcome,
		extra?: { readonly jobId?: string | undefined },
	): Promise<void>;
};

export type AttemptRecorder = { start(info: AttemptStart): AttemptRun };

export type AttemptRecorderDeps = {
	readonly log: AttemptLog;
	readonly scripts: ScriptRepository;
	readonly assets: AssetRepository;
	readonly clock: () => Date;
	// El kit de cada tipo de intento: `figma` para los scripts y pasos, `capture` para las pantallas
	readonly kits: {
		readonly figma: () => KitInfo;
		readonly capture: () => KitInfo;
	};
	readonly warn: (message: string) => void;
};

// Los fallos que se quedan antes de enviar el script a la pestaña no son un intento: el script no llegó a correr
const NEVER_RAN: readonly string[] = [
	FIGMA_ERROR_TYPE.chromeUnreachable,
	FIGMA_ERROR_TYPE.figmaTabNotFound,
	FIGMA_ERROR_TYPE.figmaNotReady,
	FIGMA_ERROR_TYPE.scriptReadError,
];

const MAX_FIRST_ERROR_CHARS = 500;

const statusOf = (outcome: AttemptOutcome): AttemptStatus =>
	outcome.ok
		? ATTEMPT_STATUS.ok
		: outcome.error.type === WEB_ERROR_TYPE.contractError
			? ATTEMPT_STATUS.contractError
			: ATTEMPT_STATUS.error;

export function makeAttemptRecorder(
	deps: AttemptRecorderDeps,
): AttemptRecorder {
	const targetOf = async (source: AttemptSource): Promise<string> =>
		source.kind === "key"
			? source.key
			: source.kind === "code"
				? CODE_TARGET
				: deps.scripts.identity(source.path);

	return {
		start(info) {
			const startedAt = info.startedAt ?? deps.clock();
			return {
				async finish(outcome, extra) {
					try {
						if (!outcome.ok && NEVER_RAN.includes(outcome.error.type)) return;
						const kit = (
							info.kind === ATTEMPT_KIND.capture
								? deps.kits.capture
								: deps.kits.figma
						)();
						const scripts: AttemptContent[] = [];
						if (info.step !== undefined) {
							scripts.push({
								role: ATTEMPT_ROLE.step,
								path: "",
								content: info.step,
							});
						}
						if (info.params !== undefined) {
							scripts.push({
								role: ATTEMPT_ROLE.params,
								path: "",
								content: JSON.stringify(info.params),
							});
						}
						scripts.push({
							role: ATTEMPT_ROLE.kit,
							path: "",
							content: kit.content,
						});
						if (info.hooks !== undefined) {
							scripts.push({ role: ATTEMPT_ROLE.hooks, ...info.hooks });
						}
						if (info.screens !== undefined) {
							scripts.push({
								role: ATTEMPT_ROLE.screens,
								path: "",
								...info.screens,
							});
						}
						if (info.sheets !== undefined) {
							scripts.push({ role: ATTEMPT_ROLE.sheets, ...info.sheets });
						}
						if (info.map !== undefined) {
							scripts.push({ role: ATTEMPT_ROLE.map, ...info.map });
						}
						if (info.plan !== undefined) {
							scripts.push({
								role: ATTEMPT_ROLE.plan,
								path: "",
								...info.plan,
							});
						}
						if (info.recognize !== undefined) {
							scripts.push({ role: ATTEMPT_ROLE.recognize, ...info.recognize });
						}
						const assets =
							info.assets === undefined || Object.keys(info.assets).length === 0
								? undefined
								: await deps.assets.describe(info.assets);
						const jobId = info.jobId ?? extra?.jobId;
						deps.log.record({
							kind: info.kind,
							target: await targetOf(info.source),
							callId: info.callId ?? null,
							jobId,
							stepIndex: info.stepIndex,
							startedAt,
							finishedAt: deps.clock(),
							status: statusOf(outcome),
							firstError: outcome.ok
								? undefined
								: outcome.error.message.slice(0, MAX_FIRST_ERROR_CHARS),
							kit: kit.version,
							assets,
							scripts,
						});
					} catch (e) {
						deps.warn(
							`histórico: no se pudo guardar el intento: ${e instanceof Error ? e.message : String(e)}`,
						);
					}
				},
			};
		},
	};
}
