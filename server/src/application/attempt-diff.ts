import {
	ATTEMPT_ROLE,
	type AttemptItem,
	type AttemptRole,
	BLOB_KIND,
	blobKindOf,
} from "#domain/attempt.ts";
import {
	ASSET_STATE,
	type AssetDiff,
	type AttemptDiff as AttemptDiffOf,
	type AttemptEnd,
	type ContentDiff as ContentDiffOf,
	ROLE_STATE,
	type RoleDiff,
} from "#domain/attempt-diff.ts";
import { err, ok, type Result } from "#domain/result.ts";
import {
	canonicalJson,
	type DiffHunk,
	type DiffOutcome,
	diffLines,
} from "#domain/text-diff.ts";
import type { History } from "./history.ts";
import type { HistoryUsageError } from "./history-range.ts";

export type AttemptDiff = AttemptDiffOf<DiffHunk>;
type ContentDiff = ContentDiffOf<DiffHunk>;

export type AttemptDiffInput = {
	readonly from: number;
	readonly to: number;
	// Papel (y ruta si tiene varias) cuyo diff se pide; sin él, el del primero que cambió
	readonly role?: string | undefined;
	readonly path?: string | undefined;
};

const usage = (type: HistoryUsageError["type"], message: string) =>
	err<HistoryUsageError>({ type, message });

const KNOWN_ROLES: readonly string[] = Object.values(ATTEMPT_ROLE);
const roleRank = (role: string) => {
	const at = KNOWN_ROLES.indexOf(role);
	return at === -1 ? KNOWN_ROLES.length : at;
};

const end = (a: AttemptItem): AttemptEnd => ({
	id: a.id,
	n: a.n,
	kind: a.kind,
	target: a.target,
	startedAt: a.startedAt,
});

type Ref = AttemptItem["scripts"][number];
type Pair = { role: string; path: string; from: Ref | null; to: Ref | null };

function pairsOf(from: AttemptItem, to: AttemptItem): Pair[] {
	const pairs = new Map<string, Pair>();
	const put = (side: "from" | "to", refs: AttemptItem["scripts"]) => {
		for (const ref of refs) {
			const key = `${ref.role}\u0000${ref.path}`;
			const pair = pairs.get(key) ?? {
				role: ref.role,
				path: ref.path,
				from: null,
				to: null,
			};
			pair[side] = ref;
			pairs.set(key, pair);
		}
	};
	put("from", from.scripts);
	put("to", to.scripts);
	return [...pairs.values()].sort(
		(a, b) =>
			roleRank(a.role) - roleRank(b.role) ||
			a.role.localeCompare(b.role) ||
			a.path.localeCompare(b.path),
	);
}

function assetsOf(from: AttemptItem, to: AttemptItem): AssetDiff[] {
	const before = new Map(from.assets.map((a) => [a.name, a]));
	const after = new Map(to.assets.map((a) => [a.name, a]));
	return [...new Set([...before.keys(), ...after.keys()])]
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((name) => {
			const a = before.get(name) ?? null;
			const b = after.get(name) ?? null;
			const state =
				a === null
					? ASSET_STATE.added
					: b === null
						? ASSET_STATE.removed
						: a.sha256 === b.sha256 && a.bytes === b.bytes
							? ASSET_STATE.same
							: ASSET_STATE.changed;
			return { name, state, from: a, to: b };
		});
}

// Compara dos intentos del mismo objetivo: qué papeles cambian (con sus líneas), el diff de uno y los assets. El
// servidor es quien lo calcula, para el panel y para el agente
export function makeAttemptDiff(deps: {
	readonly history: History;
	readonly maxEdits?: number;
}) {
	const { history } = deps;
	const text = (ref: Ref | null): string | null => {
		if (ref === null) return "";
		const found = history.script({ by: "sha256", sha256: ref.sha256 });
		return found.kind === "found" ? found.script.content : null;
	};
	const prepare = (role: string, content: string) =>
		blobKindOf(role as AttemptRole) === BLOB_KIND.json
			? canonicalJson(content)
			: content;

	return (input: AttemptDiffInput): Result<AttemptDiff, HistoryUsageError> => {
		const from = history.attemptById(input.from);
		if (from === null) {
			return usage(
				"NotFound",
				`No hay ningún intento con id ${input.from} en este proyecto.`,
			);
		}
		const to = history.attemptById(input.to);
		if (to === null) {
			return usage(
				"NotFound",
				`No hay ningún intento con id ${input.to} en este proyecto.`,
			);
		}
		if (from.kind !== to.kind || from.target !== to.target) {
			return usage(
				"InvalidInput",
				`Solo se comparan intentos del mismo objetivo: «${from.target}» (${from.kind}) y «${to.target}» (${to.kind}) no lo son.`,
			);
		}
		const pairs = pairsOf(from, to);
		if (input.role !== undefined) {
			const wanted = pairs.filter((p) => p.role === input.role);
			if (wanted.length === 0) {
				return usage(
					"NotFound",
					`Ninguno de los dos intentos tiene el papel «${input.role}».`,
				);
			}
			if (input.path === undefined && wanted.length > 1) {
				return usage(
					"InvalidInput",
					`El papel «${input.role}» tiene varias rutas; indica \`path\`: ${wanted.map((p) => `«${p.path}»`).join(", ")}.`,
				);
			}
			if (
				input.path !== undefined &&
				!wanted.some((p) => p.path === input.path)
			) {
				return usage(
					"NotFound",
					`El papel «${input.role}» no tiene la ruta «${input.path}».`,
				);
			}
		}

		const roles: RoleDiff[] = [];
		const outcomes = new Map<Pair, ContentDiff>();
		for (const pair of pairs) {
			const head = { role: pair.role, path: pair.path };
			if (
				pair.from !== null &&
				pair.to !== null &&
				pair.from.sha256 === pair.to.sha256
			) {
				roles.push({
					...head,
					state: ROLE_STATE.same,
					added: null,
					removed: null,
				});
				continue;
			}
			const before = text(pair.from);
			const after = text(pair.to);
			if (before === null || after === null) {
				roles.push({
					...head,
					state: ROLE_STATE.hashOnly,
					added: null,
					removed: null,
				});
				outcomes.set(pair, {
					...head,
					kind: "too_big",
					fromSha256: pair.from?.sha256 ?? null,
					toSha256: pair.to?.sha256 ?? null,
				});
				continue;
			}
			const state =
				pair.from === null
					? ROLE_STATE.added
					: pair.to === null
						? ROLE_STATE.removed
						: ROLE_STATE.changed;
			const outcome: DiffOutcome = diffLines(
				prepare(pair.role, before),
				prepare(pair.role, after),
				deps.maxEdits === undefined ? {} : { maxEdits: deps.maxEdits },
			);
			if (outcome.kind === "too_large") {
				roles.push({ ...head, state, added: null, removed: null });
				outcomes.set(pair, { ...head, kind: "too_large" });
				continue;
			}
			roles.push({
				...head,
				state,
				added: outcome.added,
				removed: outcome.removed,
			});
			outcomes.set(pair, {
				...head,
				kind: "diff",
				hunks: outcome.hunks,
				added: outcome.added,
				removed: outcome.removed,
			});
		}

		const chosen =
			input.role !== undefined
				? pairs.find(
						(p) =>
							p.role === input.role &&
							(input.path === undefined || p.path === input.path),
					)
				: pairs.find((p) => outcomes.has(p));
		return ok({
			from: end(from),
			to: end(to),
			roles,
			assets: assetsOf(from, to),
			diff: (chosen !== undefined ? outcomes.get(chosen) : undefined) ?? null,
		});
	};
}
