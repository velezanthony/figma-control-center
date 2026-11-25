import { ATTEMPT_KIND } from "#domain/attempt.ts";
import {
	BUILD_STATUS,
	type BuildPlan,
	type BuildStatus,
	type BuildStep,
	mergeTouched,
	type Progress,
	progressOf,
	STEP_STATUS,
	type StepResult,
} from "#domain/build.ts";
import {
	FIGMA_ERROR_TYPE,
	type FigmaError,
	paramsTooLargeError,
	unexpectedScriptError,
} from "#domain/figma-error.ts";
import { JOB_STATUS, type JobId } from "#domain/job.ts";
import { err, ok, type Result } from "#domain/result.ts";
import {
	extractTouchedNodeIds,
	missingIdsWarning,
	type RunOutcome,
} from "#domain/run-outcome.ts";
import {
	COMPOSE_KIT_STEP,
	kitStepCode,
	SCREEN_KIT_STEP,
	SHEET_KIT_STEP,
} from "#domain/step.ts";
import { buildLockMessage } from "./build-lock-message.ts";
import type { ComposePlanMaker } from "./compose-plan.ts";
import type { JobRegistry, TerminalBuildStatus } from "./job-registry.ts";
import { judgeStep, type StepChecker } from "./judge-step.ts";
import { type KitStepRun, resolveKitStep } from "./kit-step.ts";
import type { AssetRepository } from "./ports/asset-repository.ts";
import {
	type FigmaGateway,
	SCRIPT_FORMAT,
	type ScriptToRun,
} from "./ports/figma-gateway.ts";
import type { ProjectConfigSource } from "./ports/project-config.ts";
import type { ResultStore } from "./ports/result-store.ts";
import type { ScriptRepository } from "./ports/script-repository.ts";
import type { AttemptOutcome, AttemptRecorder } from "./record-attempt.ts";
import type { ScreenPlanMaker } from "./screen-plan.ts";
import type { SheetPlanMaker } from "./sheet-plan.ts";

export type RunBuildInput = {
	readonly plan: BuildPlan;
	readonly fromStep?: number;
	readonly stopOnError?: boolean;
	// La llamada de figma_build: enlaza el intento de cada paso con ella en el historial
	readonly callId?: string | undefined;
};

// Vista uniforme del lote que el presentador MCP convierte en la respuesta de la herramienta.
export type BuildOutcome = {
	readonly ok: boolean;
	readonly status: BuildStatus;
	readonly error: FigmaError | null;
	readonly touchedNodeIds: readonly string[];
	readonly retryable: boolean;
	readonly progress: Progress;
	readonly steps: readonly BuildStep[];
};

export type RunBuildResult =
	| {
			readonly kind: "finished";
			readonly jobId: JobId | null;
			readonly outcome: BuildOutcome;
	  }
	| {
			readonly kind: "running";
			readonly jobId: JobId;
			readonly outcome: BuildOutcome;
	  }
	| { readonly kind: "usage"; readonly message: string };

export type RunBuildDeps = {
	readonly gateway: FigmaGateway;
	readonly scripts: ScriptRepository;
	readonly assets: AssetRepository;
	// areas@1 del proyecto: de aquí salen los params de los pasos del kit (`use`)
	readonly project: ProjectConfigSource;
	// El plan de una pantalla (F4): lo piden los pasos `kit/build-screen@1` antes de reservar el lock
	readonly screenPlan?: ScreenPlanMaker | undefined;
	// Hojas de componentes: arma el plan de `kit/build-component@1` (sin él, ese paso es un error de uso)
	readonly sheetPlan?: SheetPlanMaker | undefined;
	// Compose@1: arma el plan de `kit/compose@1` y lo valida antes de tocar Figma (sin él, ese paso es un error de uso)
	readonly composePlan?: ComposePlanMaker | undefined;
	readonly jobs: JobRegistry;
	// El resultado de cada paso va al histórico: en línea si cabe en este tope (FCC_MAX_INLINE_RESULT_BYTES) o a fichero
	readonly store: ResultStore;
	readonly maxInlineResultBytes: number;
	readonly stepTimeoutMs: number;
	readonly maxParamsBytes: number;
	// El juez de step@1: solo se usa con pasos que declaran `// @contract step@1` en su primera línea
	readonly checkStep: StepChecker;
	// El historial de intentos: uno por paso que corre; sin él, nada se guarda
	readonly attempts?: AttemptRecorder | undefined;
	// FCC_BUILD_MAX_STEPS: vale para un manifiesto y para `steps`
	readonly maxSteps: number;
	readonly now?: () => number;
	// Tras cada paso: lo lee B6/B7 para notificar progreso, registrar actividad y proyectar en SQLite.
	readonly onProgress?: (p: {
		readonly jobId: JobId;
		readonly steps: readonly BuildStep[];
		readonly progress: Progress;
		// El paso que acaba de cambiar (para nombrarlo en el aviso de progreso)
		readonly stepIndex: number;
	}) => void;
	// Cada vez que cambia el estado de algún paso (el plan entero al empezar, `running`, finales): alimenta el histórico.
	readonly onStepsChanged?: (c: {
		readonly jobId: JobId;
		readonly steps: readonly BuildStep[];
		readonly changed: readonly number[];
	}) => void;
	// Cuando el lote termina (dentro del plazo o en segundo plano tras superarlo): cierra su estado en el histórico.
	readonly onJobFinished?: (j: {
		readonly jobId: JobId;
		readonly outcome: BuildOutcome;
		readonly ms: number;
	}) => void;
};

// Los assets se guardan como rutas: sus bytes se leen al ejecutar el paso, no todos a la vez en la validación
type Resolved = {
	readonly script: Omit<ScriptToRun, "assets">;
	readonly assets: Readonly<Record<string, string>> | undefined;
	readonly timeoutMs: number;
	readonly contents?: KitStepRun["contents"];
	readonly attemptStep?: string | undefined;
};

const defaultNow = () => performance.now();

export function makeRunBuild(deps: RunBuildDeps) {
	const now = deps.now ?? defaultNow;

	// Validación previa de los pasos a ejecutar (CA-6): params, assets y script de cada paso, y que la pestaña esté
	// lista. Si algo falla, no se toca Figma. Devuelve los scripts ya leídos; de los assets solo comprueba que existen y caben.
	const prevalidate = async (
		plan: BuildPlan,
		fromStep: number,
		kitRuns: ReadonlyMap<number, KitStepRun>,
	): Promise<Result<Map<number, Resolved>, FigmaError>> => {
		const resolved = new Map<number, Resolved>();
		for (let i = fromStep; i < plan.steps.length; i++) {
			const step = plan.steps[i];
			if (step === undefined) continue;

			// Un paso del kit: el código y los params salen de areas@1 (ya resueltos); no hay fichero que leer
			const kitRun = kitRuns.get(i);
			const effectiveParams =
				kitRun === undefined ? step.params : kitRun.params;
			const effectiveAssets =
				kitRun === undefined ? step.assets : kitRun.assets;

			if (effectiveParams !== undefined) {
				const bytes = new TextEncoder().encode(
					JSON.stringify(effectiveParams),
				).byteLength;
				if (bytes > deps.maxParamsBytes) {
					return err(paramsTooLargeError(bytes, deps.maxParamsBytes));
				}
			}

			const assets =
				effectiveAssets !== undefined && Object.keys(effectiveAssets).length > 0
					? effectiveAssets
					: undefined;
			if (assets !== undefined) {
				const checked = await deps.assets.check(assets);
				if (!checked.ok) return err(checked.error);
			}

			if (kitRun !== undefined) {
				resolved.set(i, {
					script: {
						code: kitRun.code,
						format: SCRIPT_FORMAT.body,
						params: effectiveParams as Readonly<Record<string, unknown>>,
					},
					assets,
					timeoutMs: step.timeoutMs ?? deps.stepTimeoutMs,
					contents: kitRun.contents,
					attemptStep: kitRun.attemptStep,
				});
				continue;
			}

			const read = await deps.scripts.read(step.file);
			if (!read.ok) return err(read.error);

			resolved.set(i, {
				script: {
					code: read.value,
					format: step.format,
					...(step.params !== undefined && { params: step.params }),
				},
				assets,
				timeoutMs: step.timeoutMs ?? deps.stepTimeoutMs,
			});
		}

		// La pestaña, tras lo local: sin sesión o cargando, el lote se rechaza sin job y sin tocar Figma
		const ready = await deps.gateway.ready();
		if (!ready.ok) return err(ready.error);
		return ok(resolved);
	};

	// El nombre del archivo abierto contra `expect`: null si cuadra (o no hay `expect`), el motivo si no
	const checkExpect = async (plan: BuildPlan): Promise<string | null> => {
		if (plan.expect === undefined) return null;
		const { fileName } = await deps.gateway.status();
		if (fileName === plan.expect.fileName) return null;
		const opened =
			fileName === null ? "no tiene nombre legible" : `se llama «${fileName}»`;
		return `el archivo abierto ${opened} y el lote espera «${plan.expect.fileName}»: comprueba que el proyecto apunta al archivo correcto o corrige \`expect\`.`;
	};

	// Lo que devolvió un paso para el histórico: en línea si cabe, a fichero si no, `null` si no devolvió nada
	// El informe de desfase de un paso (`report.drift`) a reads/, donde lo leerá luego la página «Desfases»; null si no hay
	const keepDrift = async (value: unknown): Promise<string | null> => {
		const drift = (value as { report?: { drift?: { sheet?: unknown } } } | null)
			?.report?.drift;
		if (drift === undefined || typeof drift.sheet !== "string") return null;
		const stored = await deps.store.saveRead(JSON.stringify(drift, null, 2), {
			tool: `desfase_${drift.sheet}`,
			at: new Date(),
		});
		return stored.path;
	};

	const keepResult = async (value: unknown): Promise<StepResult | null> => {
		if (value === undefined || value === null) return null;
		const json = JSON.stringify(value);
		const bytes = new TextEncoder().encode(json).byteLength;
		if (bytes <= deps.maxInlineResultBytes) return { kind: "inline", json };
		const stored = await deps.store.saveJson(json);
		return { kind: "file", path: stored.path, bytes: stored.bytes };
	};

	return async (input: RunBuildInput): Promise<RunBuildResult> => {
		const total = input.plan.steps.length;
		if (total > deps.maxSteps) {
			return {
				kind: "usage",
				message: `el lote tiene ${total} pasos y el tope es de ${deps.maxSteps} (FCC_BUILD_MAX_STEPS).`,
			};
		}
		if ((input.fromStep ?? 0) >= total) {
			return {
				kind: "usage",
				message: `fromStep ${input.fromStep} no existe: el lote tiene ${total} pasos (índices 0 a ${total - 1}).`,
			};
		}

		// Un lote a la vez: un lote en marcha bloquea otro figma_build (y los figma_run_script que escriben).
		const active = deps.jobs.activeBuild();
		if (active !== undefined) {
			return {
				kind: "usage",
				message: buildLockMessage(deps.jobs, active),
			};
		}

		const fromStep = input.fromStep ?? 0;
		const stopOnError = input.stopOnError ?? true;
		const plan = input.plan;

		const initialSteps: BuildStep[] = plan.steps.map((step, i) => ({
			index: i,
			file: step.file,
			status: i < fromStep ? STEP_STATUS.skipped : STEP_STATUS.pending,
			ms: null,
			touchedCount: 0,
			error: null,
			warning: null,
			result: null,
		}));

		// Los pasos del kit sacan su código y sus params de areas@1 (D-3). Se resuelve ANTES de reservar el lock: un proyecto
		// sin `areas`, un areas.json inválido o un área desconocida rechazan el lote sin job, sin lock y sin tocar la pestaña
		const kitRuns = new Map<number, KitStepRun>();
		const kitIndexes = plan.steps.flatMap((s, i) =>
			i >= fromStep && s.kit !== undefined ? [i] : [],
		);
		if (kitIndexes.length > 0) {
			const loaded = await deps.project.load();
			const rejected = (error: FigmaError): RunBuildResult => ({
				kind: "finished",
				jobId: null,
				outcome: {
					ok: false,
					status: BUILD_STATUS.failed,
					error,
					touchedNodeIds: [],
					retryable: error.retryable,
					progress: progressOf(initialSteps),
					steps: initialSteps,
				},
			});
			if (!loaded.ok) return rejected(loaded.error);
			for (const i of kitIndexes) {
				const kit = plan.steps[i]?.kit;
				if (kit === undefined) continue;
				if (kit.step === SCREEN_KIT_STEP) {
					if (deps.screenPlan === undefined) {
						return {
							kind: "usage",
							message:
								"este servidor no tiene montado el plan de pantallas (kit/build-screen@1).",
						};
					}
					const made = await deps.screenPlan(loaded.value, {
						screen: kit.screen ?? "",
						area: kit.area,
						variant: kit.variant,
						capture: kit.capture,
					});
					if (made.kind === "usage") {
						return { kind: "usage", message: made.message };
					}
					if (made.kind === "error") return rejected(made.error);
					kitRuns.set(i, {
						code: kitStepCode(kit.step, {
							recognize: made.run.recognizeSource,
						}),
						params: made.run.params,
						assets: made.run.assets,
						contents: made.run.contents,
						attemptStep: kitStepCode(kit.step),
					});
					continue;
				}
				if (kit.step === SHEET_KIT_STEP) {
					if (deps.sheetPlan === undefined) {
						return {
							kind: "usage",
							message:
								"este servidor no tiene montado el plan de hojas (kit/build-component@1).",
						};
					}
					const made = await deps.sheetPlan(loaded.value, {
						sheet: kit.sheet ?? "",
						scratch: kit.scratch,
					});
					if (made.kind === "usage") {
						return { kind: "usage", message: made.message };
					}
					if (made.kind === "error") return rejected(made.error);
					kitRuns.set(i, {
						code: kitStepCode(kit.step, {
							recognize: made.run.recognizeSource,
						}),
						params: made.run.params,
						assets: made.run.assets,
						contents: made.run.contents,
						attemptStep: kitStepCode(kit.step),
					});
					continue;
				}
				if (kit.step === COMPOSE_KIT_STEP) {
					if (deps.composePlan === undefined) {
						return {
							kind: "usage",
							message:
								"este servidor no tiene montado el plan de compose (kit/compose@1).",
						};
					}
					const made = await deps.composePlan(loaded.value, {
						compose: kit.compose ?? "",
					});
					if (made.kind === "usage") {
						return { kind: "usage", message: made.message };
					}
					if (made.kind === "error") return rejected(made.error);
					kitRuns.set(i, {
						code: kitStepCode(kit.step),
						params: made.run.params,
						assets: undefined,
						contents: made.run.contents,
						attemptStep: kitStepCode(kit.step),
					});
					continue;
				}
				const resolution = resolveKitStep(
					kit.step,
					kit.area ?? "",
					loaded.value,
				);
				if (resolution.kind === "no-areas") return rejected(resolution.error);
				if (resolution.kind === "unknown-area") {
					return { kind: "usage", message: resolution.message };
				}
				kitRuns.set(i, resolution.run);
			}
		}

		// Reserva el lock de forma SÍNCRONA, antes de cualquier await: dos figma_build —o un build y un
		// figma_run_script— que lleguen a la vez no pueden colarse durante la validación (sin TOCTOU).
		const jobId = deps.jobs.tryStartBuild(initialSteps);
		if (jobId === undefined) {
			// Otra sesión (otro proceso) se adelantó con el lock entre la comprobación y la reserva
			const holder = deps.jobs.activeBuild();
			return {
				kind: "usage",
				message:
					holder === undefined
						? "otra sesión de Claude Code acaba de tomar el lote de este archivo de Figma; reintenta en un momento."
						: buildLockMessage(deps.jobs, holder),
			};
		}
		const startedAt = now();

		const validation = await prevalidate(plan, fromStep, kitRuns);
		if (!validation.ok) {
			// La reserva no llegó a ejecutarse: se deshace para liberar el lock (jobId null, como si no hubiera job).
			deps.jobs.abandonBuild(jobId);
			return {
				kind: "finished",
				jobId: null,
				outcome: {
					ok: false,
					status: BUILD_STATUS.failed,
					error: validation.error,
					touchedNodeIds: [],
					retryable: validation.error.retryable,
					progress: progressOf(initialSteps),
					steps: initialSteps,
				},
			};
		}
		const mismatch = await checkExpect(plan);
		if (mismatch !== null) {
			deps.jobs.abandonBuild(jobId);
			return { kind: "usage", message: mismatch };
		}
		const resolved = validation.value;
		deps.onStepsChanged?.({
			jobId,
			steps: [...initialSteps],
			changed: initialSteps.map((s) => s.index),
		});

		// Fuera de runSteps: si un callback lanza, el cierre de emergencia conserva lo que ya se hizo
		const liveSteps = [...initialSteps];
		const touchedLists: string[][] = [];

		const runSteps = async (): Promise<BuildOutcome> => {
			const steps = liveSteps;
			let anyRan = false;
			let cancelled = false;
			let failError: FigmaError | null = null;

			for (let i = fromStep; i < plan.steps.length; i++) {
				const r = resolved.get(i);
				const current = steps[i];
				if (r === undefined || current === undefined) continue;

				if (deps.jobs.isCancelRequested(jobId)) {
					cancelled = true;
					break;
				}

				steps[i] = { ...current, status: STEP_STATUS.running };
				deps.jobs.updateBuild(jobId, [...steps]);
				deps.onStepsChanged?.({ jobId, steps: [...steps], changed: [i] });

				const attempt = deps.attempts?.start({
					kind: ATTEMPT_KIND.buildStep,
					// Un paso del kit no tiene fichero: su objetivo es su etiqueta (`kit/place@1 · Panel`)
					source:
						plan.steps[i]?.kit === undefined
							? { kind: "file", path: plan.steps[i]?.file ?? "" }
							: { kind: "key", key: plan.steps[i]?.file ?? "" },
					step: r.attemptStep ?? r.script.code,
					params: r.script.params,
					assets: r.assets,
					...(r.contents !== undefined && {
						plan: { content: r.contents.plan },
						...("map" in r.contents && { map: r.contents.map }),
						...("sheets" in r.contents &&
							r.contents.sheets !== undefined && {
								sheets: r.contents.sheets,
							}),
						...("recognize" in r.contents &&
							r.contents.recognize !== undefined && {
								recognize: r.contents.recognize,
							}),
					}),
					callId: input.callId,
					jobId,
					stepIndex: i,
				});
				const start = now();
				let run: Awaited<ReturnType<typeof deps.gateway.run>>;
				try {
					const bytes =
						r.assets === undefined
							? ok(undefined)
							: await deps.assets.read(r.assets);
					run = bytes.ok
						? await deps.gateway.run(
								bytes.value === undefined
									? r.script
									: { ...r.script, assets: bytes.value },
								{ timeoutMs: r.timeoutMs, installKit: true },
							)
						: err(bytes.error);
				} catch (e) {
					// Un rechazo del transporte (p. ej. CDP caído) es un paso fallido, no revienta el lote
					run = err(unexpectedScriptError(e));
				}
				const ms = now() - start;
				anyRan = true;

				// Con cabecera `// @contract step@1` el resultado se juzga; sin ella, la regla de M2
				const judgement = run.ok
					? judgeStep(r.script.code, run.value, deps.checkStep)
					: null;
				const attemptOutcome: AttemptOutcome = !run.ok
					? { ok: false, error: run.error }
					: judgement?.kind === "violated"
						? { ok: false, error: judgement.error }
						: { ok: true };
				await attempt?.finish(attemptOutcome);
				if (run.ok && judgement?.kind === "violated") {
					// El script ya corrió: sus ids legibles cuentan y el resultado queda en el histórico
					failError ??= judgement.error;
					touchedLists.push([...judgement.touched]);
					steps[i] = {
						...current,
						status: STEP_STATUS.failed,
						ms,
						touchedCount: judgement.touched.length,
						error: judgement.error,
						warning: null,
						result: await keepResult(run.value),
					};
				} else if (run.ok) {
					const touched =
						judgement?.kind === "ok"
							? [...judgement.touched]
							: extractTouchedNodeIds(run.value);
					touchedLists.push(touched);
					const result = await keepResult(run.value);
					const base =
						judgement?.kind === "ok"
							? (judgement.warning ?? null)
							: (missingIdsWarning(run.value) ?? null);
					// Un desfase entre Figma y la web: el informe entero va a reads/ y su ruta, en el aviso
					const driftPath = await keepDrift(run.value);
					steps[i] = {
						...current,
						status: STEP_STATUS.done,
						ms,
						touchedCount: touched.length,
						error: null,
						warning:
							driftPath === null
								? base
								: `${base === null ? "" : `${base}; `}detalle del desfase: ${driftPath}`,
						result,
					};
				} else {
					if (failError === null) failError = run.error;
					steps[i] = {
						...current,
						status: STEP_STATUS.failed,
						ms,
						touchedCount: 0,
						error: run.error,
						warning: null,
						result: null,
					};
				}

				deps.jobs.updateBuild(jobId, [...steps]);
				deps.onStepsChanged?.({ jobId, steps: [...steps], changed: [i] });
				deps.onProgress?.({
					jobId,
					steps: [...steps],
					progress: progressOf(steps),
					stepIndex: i,
				});

				if (!run.ok && run.error.type === FIGMA_ERROR_TYPE.timeout) {
					// El script vencido sigue en la pestaña: nada más se le envía y el lock espera a que acabe
					const stale = deps.gateway.orphanedScript();
					if (stale !== undefined) deps.jobs.holdBuildLock(jobId, stale);
					break;
				}
				if (steps[i]?.status === STEP_STATUS.failed && stopOnError) break;
			}

			// Los pasos que no llegaron a empezar quedan `cancelled` cuando se pidió cancelar.
			if (cancelled) {
				const changed: number[] = [];
				for (let j = 0; j < steps.length; j++) {
					const s = steps[j];
					if (s !== undefined && s.status === STEP_STATUS.pending) {
						steps[j] = { ...s, status: STEP_STATUS.cancelled };
						changed.push(j);
					}
				}
				deps.onStepsChanged?.({ jobId, steps: [...steps], changed });
			}

			const touchedNodeIds = mergeTouched(touchedLists);
			// El estado TERMINAL de un lote detenido lo fija aquí (no `buildStatusOf`, que solo ve progreso en vivo).
			let status: TerminalBuildStatus;
			let outcome: RunOutcome;
			if (cancelled) {
				status = JOB_STATUS.cancelled;
				outcome = {
					ok: true,
					result: null,
					error: null,
					touchedNodeIds,
					retryable: false,
				};
			} else if (failError !== null) {
				status = JOB_STATUS.failed;
				outcome = {
					ok: false,
					result: null,
					error: failError,
					touchedNodeIds,
					retryable: !anyRan && failError.retryable,
				};
			} else {
				status = JOB_STATUS.done;
				outcome = {
					ok: true,
					result: null,
					error: null,
					touchedNodeIds,
					retryable: false,
				};
			}

			deps.jobs.completeBuild(jobId, status, outcome, [...steps]);
			return {
				ok: outcome.ok,
				status,
				error: outcome.error,
				touchedNodeIds,
				retryable: outcome.retryable,
				progress: progressOf(steps),
				steps: [...steps],
			};
		};

		// Red de seguridad: ningún throw inesperado (un callback que lanza, etc.) debe dejar el lock puesto para
		// siempre ni colgar cancel-job. Pase lo que pase, el lote cierra como `failed` y se libera el registro.
		const work = runSteps().catch((e): BuildOutcome => {
			const error = unexpectedScriptError(e);
			// Un paso que quedó en curso no llegó a acabar: se cierra como fallido con este error
			const closed = liveSteps.map((s) =>
				s.status === STEP_STATUS.running
					? { ...s, status: STEP_STATUS.failed, error }
					: s,
			);
			const touchedNodeIds = mergeTouched(touchedLists);
			const outcome: RunOutcome = {
				ok: false,
				result: null,
				error,
				touchedNodeIds,
				retryable: false,
			};
			deps.jobs.completeBuild(jobId, JOB_STATUS.failed, outcome, closed);
			return {
				ok: false,
				status: JOB_STATUS.failed,
				error,
				touchedNodeIds,
				retryable: false,
				progress: progressOf(closed),
				steps: closed,
			};
		});
		// El lote corre en segundo plano: se responde ya, con el jobId y el plan entero, y el estado final se ve con
		// figma_get_job (waitMs). onJobFinished cierra su fila en el histórico al terminar (una sola vez).
		void work.then((outcome) =>
			deps.onJobFinished?.({ jobId, outcome, ms: now() - startedAt }),
		);

		return {
			kind: "running",
			jobId,
			outcome: {
				ok: true,
				status: BUILD_STATUS.running,
				error: null,
				touchedNodeIds: [],
				retryable: false,
				progress: progressOf(initialSteps),
				steps: initialSteps,
			},
		};
	};
}
