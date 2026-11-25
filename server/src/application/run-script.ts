import { ATTEMPT_KIND } from "#domain/attempt.ts";
import {
	paramsTooLargeError,
	unexpectedScriptError,
} from "#domain/figma-error.ts";
import type { JobId } from "#domain/job.ts";
import {
	isResultFileName,
	RESULT_FILE_NAME_RULE,
} from "#domain/result-file.ts";
import {
	extractTouchedNodeIds,
	failed,
	missingIdsWarning,
	type RunOutcome,
	succeeded,
} from "#domain/run-outcome.ts";
import { buildLockMessage } from "./build-lock-message.ts";
import type { JobRegistry } from "./job-registry.ts";
import { judgeStep, type StepChecker } from "./judge-step.ts";
import type { AssetRepository } from "./ports/asset-repository.ts";
import type {
	FigmaGateway,
	ScriptFormat,
	ScriptToRun,
} from "./ports/figma-gateway.ts";
import type { ResultStore } from "./ports/result-store.ts";
import type { ScriptRepository } from "./ports/script-repository.ts";
import type { AttemptRecorder, AttemptRun } from "./record-attempt.ts";
import { withSoftDeadline } from "./with-soft-deadline.ts";

export type RunScriptInput = {
	readonly source:
		| { readonly kind: "file"; readonly path: string }
		| { readonly kind: "code"; readonly code: string };
	readonly format: ScriptFormat;
	readonly timeoutMs?: number | undefined;
	// Datos pequeños (valor JSON) y assets (nombre → ruta del fichero) que el script recibe
	readonly params?: unknown;
	readonly assets?: Readonly<Record<string, string>>;
	// Nombre del fichero de results/ donde va SIEMPRE el resultado; se pisa si existe
	readonly resultFile?: string | undefined;
	// La llamada de la herramienta que lo pide: enlaza el intento con su llamada en el historial
	readonly callId?: string | undefined;
};

export type RunScriptResult =
	| { readonly kind: "finished"; readonly outcome: RunOutcome }
	| { readonly kind: "running"; readonly jobId: JobId }
	// Un lote en marcha bloquea toda escritura: se rechaza con un error de uso.
	| { readonly kind: "usage"; readonly message: string };

export type RunScriptDeps = {
	readonly gateway: FigmaGateway;
	readonly scripts: ScriptRepository;
	readonly assets: AssetRepository;
	readonly store: ResultStore;
	readonly jobs: JobRegistry;
	readonly softDeadlineMs: number;
	readonly maxInlineResultBytes: number;
	readonly maxParamsBytes: number;
	// El juez de step@1: solo se usa con scripts que declaran `// @contract step@1` en su primera línea
	readonly checkStep: StepChecker;
	// El historial de intentos; sin él, nada se guarda
	readonly attempts?: AttemptRecorder | undefined;
	// Reloj monótono en ms (por defecto, performance.now) para medir lo que tarda un job
	readonly now?: () => number;
	// Se avisa solo de los jobs, es decir, de los scripts que superaron el plazo blando
	readonly onJobFinished?: (job: {
		readonly jobId: JobId;
		readonly outcome: RunOutcome;
		readonly ms: number;
	}) => void;
};

const defaultNow = () => performance.now();

export function makeRunScript(deps: RunScriptDeps) {
	const now = deps.now ?? defaultNow;

	// `result` grande va a disco: la respuesta lleva { path, bytes }. Con `resultFile`, va siempre a results/<nombre>
	const toOutcome = async (
		returned: unknown,
		resultFile: string | undefined,
		code: string,
	): Promise<RunOutcome> => {
		const judgement = judgeStep(code, returned, deps.checkStep);
		if (judgement.kind === "violated") {
			// El script ya corrió: se devuelven los ids que se pudieron leer y no es reintentable
			return {
				ok: false,
				result: null,
				error: judgement.error,
				touchedNodeIds: judgement.touched,
				retryable: false,
			};
		}
		const touched =
			judgement.kind === "ok"
				? judgement.touched
				: extractTouchedNodeIds(returned);
		const json = JSON.stringify(returned ?? null);
		const bytes = new TextEncoder().encode(json).byteLength;
		const result =
			resultFile !== undefined
				? await deps.store.saveResult(resultFile, json)
				: bytes <= deps.maxInlineResultBytes
					? (returned ?? null)
					: await deps.store.saveJson(json);
		const warning =
			judgement.kind === "ok" ? judgement.warning : missingIdsWarning(returned);
		return succeeded(result, touched, warning);
	};

	const execute = async (
		script: ScriptToRun,
		timeoutMs: number | undefined,
		resultFile: string | undefined,
		attempt: AttemptRun | undefined,
		jobIdNow: () => string | undefined,
	): Promise<RunOutcome> => {
		const run = await deps.gateway.run(script, { timeoutMs, installKit: true });
		const outcome = run.ok
			? await toOutcome(run.value, resultFile, script.code)
			: failed(run.error);
		await attempt?.finish(
			outcome.ok ? { ok: true } : { ok: false, error: outcome.error },
			{ jobId: jobIdNow() },
		);
		return outcome;
	};

	return async (input: RunScriptInput): Promise<RunScriptResult> => {
		// Un lote a la vez: mientras hay un lote en marcha no se escribe por otra vía.
		const activeBuild = deps.jobs.activeBuild();
		if (activeBuild !== undefined) {
			return {
				kind: "usage",
				message: buildLockMessage(deps.jobs, activeBuild),
			};
		}

		// Toda la validación ocurre antes de tocar Figma (CA-6)
		if (input.resultFile !== undefined && !isResultFileName(input.resultFile)) {
			return {
				kind: "usage",
				message: `\`resultFile\` no es válido («${input.resultFile}»): ${RESULT_FILE_NAME_RULE}. El fichero va siempre a results/ de la carpeta de salida del proyecto.`,
			};
		}
		if (input.params !== undefined) {
			const bytes = new TextEncoder().encode(
				JSON.stringify(input.params),
			).byteLength;
			if (bytes > deps.maxParamsBytes) {
				return {
					kind: "finished",
					outcome: failed(paramsTooLargeError(bytes, deps.maxParamsBytes)),
				};
			}
		}

		let code: string;
		if (input.source.kind === "file") {
			const read = await deps.scripts.read(input.source.path);
			if (!read.ok) return { kind: "finished", outcome: failed(read.error) };
			code = read.value;
		} else {
			code = input.source.code;
		}

		let assets: Readonly<Record<string, Uint8Array>> | undefined;
		if (input.assets !== undefined && Object.keys(input.assets).length > 0) {
			const read = await deps.assets.read(input.assets);
			if (!read.ok) return { kind: "finished", outcome: failed(read.error) };
			assets = read.value;
		}

		const script: ScriptToRun = {
			code,
			format: input.format,
			...(input.params !== undefined && { params: input.params }),
			...(assets !== undefined && { assets }),
		};

		// La pestaña se espera ANTES de la carrera contra el plazo blando: un job solo existe si el script ya se envió
		const ready = await deps.gateway.ready();
		if (!ready.ok) return { kind: "finished", outcome: failed(ready.error) };

		const startedAt = now();
		const attempt = deps.attempts?.start({
			kind: ATTEMPT_KIND.runScript,
			source:
				input.source.kind === "file"
					? { kind: "file", path: input.source.path }
					: { kind: "code" },
			step: code,
			params: input.params,
			assets: input.assets,
			callId: input.callId,
		});
		// El job solo existe si el script pasa del plazo blando: el intento lo anota al acabar, si ya lo hay
		let startedJob: string | undefined;
		const running = execute(
			script,
			input.timeoutMs,
			input.resultFile,
			attempt,
			() => startedJob,
		);
		const race = await withSoftDeadline(running, deps.softDeadlineMs);
		if (race.kind === "finished") {
			return { kind: "finished", outcome: race.value };
		}

		const jobId = deps.jobs.start();
		startedJob = jobId;
		const finish = (outcome: RunOutcome) => {
			deps.jobs.complete(jobId, outcome);
			deps.onJobFinished?.({ jobId, outcome, ms: now() - startedAt });
		};
		running.then(finish, (e: unknown) =>
			finish(failed(unexpectedScriptError(e))),
		);
		return { kind: "running", jobId };
	};
}
