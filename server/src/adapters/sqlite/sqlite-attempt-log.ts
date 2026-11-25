import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { and, eq, max, sql } from "drizzle-orm";
import type {
	AttemptInput,
	AttemptLog,
	RecordedAttempt,
} from "#application/ports/attempt-log.ts";
import { blobKindOf, SCRIPT_STORED } from "#domain/attempt.ts";
import type { FigmaDb } from "./database.ts";
import { attemptScripts, attempts, scriptBlobs } from "./schema.ts";

type Tx = Parameters<Parameters<FigmaDb["transaction"]>[0]>[0];

// BEGIN IMMEDIATE: quien va a escribir lo dice desde el principio (varios procesos comparten la base)
const WRITE_TX = { behavior: "immediate" } as const;

const sha256Of = (text: string): string =>
	createHash("sha256").update(text, "utf8").digest("hex");

// Escribe el historial de intentos de UN proyecto: contenidos sin repetir y comprimidos, y una
// fila por intento con su número por tipo y objetivo, todo en una transacción
export class SqliteAttemptLog implements AttemptLog {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #warn: (message: string) => void;
	// El tope se lee en cada intento: se cambia desde «Ajustes» sin reiniciar
	readonly #maxScriptBytes: () => number;

	constructor(options: {
		readonly db: FigmaDb;
		readonly projectId: number;
		readonly warn: (message: string) => void;
		readonly maxScriptBytes: () => number;
	}) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#warn = options.warn;
		this.#maxScriptBytes = options.maxScriptBytes;
	}

	record(input: AttemptInput): RecordedAttempt | null {
		try {
			return this.#db.transaction((tx) => this.#insert(tx, input), WRITE_TX);
		} catch (e) {
			this.#warn(
				`histórico: no se pudo registrar el intento de ${input.target}: ${e instanceof Error ? e.message : String(e)}`,
			);
			return null;
		}
	}

	#insert(tx: Tx, input: AttemptInput): RecordedAttempt {
		const projectId = this.#projectId;
		const at = input.finishedAt.getTime();
		const maxBytes = this.#maxScriptBytes();

		const refs = input.scripts.map((script) => {
			const sha256 = sha256Of(script.content);
			const bytes = Buffer.byteLength(script.content, "utf8");
			const existing = tx
				.select({ stored: scriptBlobs.stored })
				.from(scriptBlobs)
				.where(
					and(
						eq(scriptBlobs.projectId, projectId),
						eq(scriptBlobs.sha256, sha256),
					),
				)
				.get();
			const fits = bytes <= maxBytes;
			if (existing === undefined) {
				tx.insert(scriptBlobs)
					.values({
						projectId,
						sha256,
						kind: blobKindOf(script.role),
						bytes,
						stored: fits ? SCRIPT_STORED.full : SCRIPT_STORED.tooBig,
						content: fits
							? gzipSync(Buffer.from(script.content, "utf8"))
							: null,
						firstAt: at,
						lastUsedAt: at,
					})
					.run();
			} else {
				// Mismo contenido: solo se anota que se volvió a usar. Si antes no cupo y ahora sí (el tope subió), se guarda
				const upgrade =
					existing.stored === SCRIPT_STORED.tooBig && fits
						? {
								stored: SCRIPT_STORED.full,
								content: gzipSync(Buffer.from(script.content, "utf8")),
							}
						: {};
				tx.update(scriptBlobs)
					.set({
						lastUsedAt: sql`max(${scriptBlobs.lastUsedAt}, ${at})`,
						...upgrade,
					})
					.where(
						and(
							eq(scriptBlobs.projectId, projectId),
							eq(scriptBlobs.sha256, sha256),
						),
					)
					.run();
			}
			return { role: script.role, path: script.path, sha256 };
		});

		const last = tx
			.select({ n: max(attempts.n) })
			.from(attempts)
			.where(
				and(
					eq(attempts.projectId, projectId),
					eq(attempts.kind, input.kind),
					eq(attempts.target, input.target),
				),
			)
			.get();
		const n = (last?.n ?? 0) + 1;
		const kitSha = refs.find((r) => r.role === "kit")?.sha256 ?? "";
		const row = tx
			.insert(attempts)
			.values({
				projectId,
				kind: input.kind,
				target: input.target,
				n,
				callId: input.callId,
				jobId: input.jobId ?? null,
				stepIndex: input.stepIndex ?? null,
				startedAt: input.startedAt.getTime(),
				finishedAt: at,
				status: input.status,
				firstError: input.firstError ?? null,
				kit: input.kit,
				kitSha256: kitSha,
				assetsJson:
					input.assets === undefined ? null : JSON.stringify(input.assets),
			})
			.returning({ id: attempts.id })
			.get();
		for (const ref of refs) {
			tx.insert(attemptScripts)
				.values({ projectId, attemptId: row.id, ...ref })
				.onConflictDoNothing()
				.run();
		}
		return { id: row.id, n };
	}
}
