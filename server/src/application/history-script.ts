import type { AttemptRole } from "#domain/attempt.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { History } from "./history.ts";
import type { HistoryUsageError } from "./history-range.ts";
import type { ResultStore } from "./ports/result-store.ts";

// Qué contenido se pide a figma_history_script: el de un papel de un intento (`attempt` es su id, `path` si el papel
// tiene varios), o directamente por su hash
export type HistoryScriptInput = {
	readonly attempt?: number | undefined;
	readonly role?: AttemptRole | undefined;
	readonly path?: string | undefined;
	readonly sha256?: string | undefined;
};

export type HistoryScriptOutput = {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
};

const usage = (
	message: string,
	type: HistoryUsageError["type"] = "InvalidInput",
) => err<HistoryUsageError>({ type, message });

const SHA256_HEX = /^[0-9a-f]{64}$/;

// figma_history_script: vuelca el contenido exacto de un intento a la carpeta de salida (nunca por la conversación) y
// devuelve su ruta. Es lo único del historial que escribe fuera de la base
export function makeHistoryScript(deps: {
	readonly history: History;
	readonly store: ResultStore;
}) {
	return async (
		input: HistoryScriptInput,
	): Promise<Result<HistoryScriptOutput, HistoryUsageError>> => {
		const byAttempt = input.attempt !== undefined || input.role !== undefined;
		const bySha = input.sha256 !== undefined;
		if (byAttempt === bySha) {
			return usage(
				"Indica `attempt` y `role` (el id de un intento y el papel: step, params, kit, hooks o screens), o bien un `sha256`; no las dos cosas ni ninguna.",
			);
		}
		let selector: Parameters<History["script"]>[0];
		if (bySha) {
			if (!SHA256_HEX.test(input.sha256 ?? "")) {
				return usage("`sha256` son 64 caracteres hexadecimales en minúscula.");
			}
			selector = { by: "sha256", sha256: input.sha256 as string };
		} else {
			if (input.attempt === undefined || input.role === undefined) {
				return usage("Con `attempt` hace falta también `role`, y al revés.");
			}
			selector = {
				by: "attempt",
				attemptId: input.attempt,
				role: input.role,
				path: input.path,
			};
		}
		const found = deps.history.script(selector);
		if (found.kind === "not_found") {
			return usage(
				bySha
					? "No hay ningún contenido con ese hash en el historial de intentos."
					: `El intento ${input.attempt} no existe o no usó el papel «${input.role}»${input.path === undefined ? "" : ` con la ruta «${input.path}»`}.`,
				"NotFound",
			);
		}
		if (found.kind === "needs_path") {
			return usage(
				`El papel «${input.role}» del intento ${input.attempt} tiene varios contenidos: indica \`path\` con uno de ${found.paths.map((p) => `«${p}»`).join(", ")}.`,
			);
		}
		const { script } = found;
		if (script.content === null) {
			return usage(
				`Ese contenido (${script.sha256}, ${script.bytes} bytes) pasó de FCC_SCRIPT_MAX_BYTES y solo se guardó su hash y su tamaño: no hay contenido que escribir.`,
			);
		}
		const stored = await deps.store.saveScript(
			script.sha256,
			script.kind,
			script.content,
		);
		return ok({
			path: stored.path,
			bytes: stored.bytes,
			sha256: script.sha256,
		});
	};
}
