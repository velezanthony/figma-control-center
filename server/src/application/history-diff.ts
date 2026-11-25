import type { AssetDiff, RoleDiff } from "#domain/attempt-diff.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { limitText, toUnifiedDiff } from "#domain/text-diff.ts";
import { type AttemptDiffInput, makeAttemptDiff } from "./attempt-diff.ts";
import type { History } from "./history.ts";
import type { HistoryUsageError } from "./history-range.ts";
import type { ResultStore } from "./ports/result-store.ts";

// El diff de UN papel tal como lo ve el agente: texto unificado recortado y, si lo hay, el fichero con el entero
export type HistoryDiffContent = {
	readonly role: string;
	readonly path: string;
	readonly kind: "diff" | "too_large" | "too_big";
	readonly added: number | null;
	readonly removed: number | null;
	readonly text: string;
	readonly truncated: boolean;
	readonly file: string | null;
	readonly fromSha256: string | null;
	readonly toSha256: string | null;
};

export type HistoryDiffOutput = {
	readonly from: { readonly id: number; readonly n: number };
	readonly to: { readonly id: number; readonly n: number };
	readonly target: string;
	readonly kind: string;
	readonly roles: readonly RoleDiff[];
	readonly assets: readonly AssetDiff[];
	readonly diff: HistoryDiffContent | null;
};

// Una parte de un nombre de fichero: solo letras, cifras, «_» y «-»
const safe = (part: string) => part.replaceAll(/[^A-Za-z0-9_-]+/g, "_");

// figma_history_diff: compara dos intentos del mismo objetivo con el mismo cálculo que el panel. Responde con el resumen
// por papel y el diff de uno recortado a `inlineLines`; el entero va a `history-diffs/` de la carpeta de salida
export function makeHistoryDiff(deps: {
	readonly history: History;
	readonly store: ResultStore;
	readonly inlineLines: number;
}) {
	const compare = makeAttemptDiff({ history: deps.history });
	return async (
		input: AttemptDiffInput,
	): Promise<Result<HistoryDiffOutput, HistoryUsageError>> => {
		const compared = compare(input);
		if (!compared.ok) return err(compared.error);
		const { value } = compared;
		const diff = value.diff;
		let content: HistoryDiffContent | null = null;
		if (diff !== null) {
			const head = { role: diff.role, path: diff.path };
			if (diff.kind === "diff") {
				const text = toUnifiedDiff(diff.hunks);
				const cut = limitText(text, deps.inlineLines);
				const file =
					text === ""
						? null
						: (
								await deps.store.saveDiff(
									`${value.from.id}-${value.to.id}-${safe(diff.role)}${diff.path === "" ? "" : `-${safe(diff.path)}`}.diff`,
									`--- ${value.from.target} (intento ${value.from.n})\n+++ ${value.to.target} (intento ${value.to.n})\n${text}`,
								)
							).path;
				content = {
					...head,
					kind: "diff",
					added: diff.added,
					removed: diff.removed,
					text: cut.content,
					truncated: cut.truncated,
					file,
					fromSha256: null,
					toSha256: null,
				};
			} else {
				content = {
					...head,
					kind: diff.kind,
					added: null,
					removed: null,
					text: "",
					truncated: false,
					file: null,
					fromSha256: diff.kind === "too_big" ? diff.fromSha256 : null,
					toSha256: diff.kind === "too_big" ? diff.toSha256 : null,
				};
			}
		}
		return ok({
			from: { id: value.from.id, n: value.from.n },
			to: { id: value.to.id, n: value.to.n },
			target: value.from.target,
			kind: value.from.kind,
			roles: value.roles,
			assets: value.assets,
			diff: content,
		});
	};
}
