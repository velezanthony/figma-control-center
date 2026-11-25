// Dos proyectos en la MISMA base, sembrados con las mismas claves (sesión, llamadas, job, nodos, id de petición) y
// contenido distinto: lo único que los separa es el proyecto. Lo usan los tests de aislamiento del adaptador y de las
// herramientas del histórico.
import assert from "node:assert/strict";
import type { ResolvedRange } from "#domain/history.ts";
import { SqliteActivityLog } from "../sqlite-activity-log.ts";
import { SqliteActivitySource } from "../sqlite-activity-source.ts";
import { SqliteAttemptLog } from "../sqlite-attempt-log.ts";
import {
	SqliteCancelMailbox,
	SqliteCancelPanel,
} from "../sqlite-cancel-requests.ts";
import { SqliteChatMailbox, SqliteChatPanel } from "../sqlite-chat.ts";
import { SqliteHistoryQuery } from "../sqlite-history-query.ts";
import {
	SqlitePermissionMailbox,
	SqlitePermissionPanel,
} from "../sqlite-permissions.ts";
import {
	buildStepFinished,
	jobFinished,
	screenshotSaved,
	scriptError,
	sessionStarted,
	statusChecked,
	toolCalled,
	toolFinished,
} from "./events.ts";
import { openTestDb } from "./projects.ts";

export type Owner = { readonly id: number; readonly tag: "A" | "B" };
export const A: Owner = { id: 1, tag: "A" };
export const B: Owner = { id: 2, tag: "B" };
export const OWNERS = [A, B] as const;
export const other = (o: Owner): Owner => (o === A ? B : A);

export const SHARED_SESSION = "sesion-compartida";
export const ALL: ResolvedRange = { fromMs: null, toMs: null, sessionId: null };
export const token = (o: Owner) => `token-de-${o.tag}`;
export const creds = (o: Owner) => ({
	sessionId: SHARED_SESSION,
	token: token(o),
});
export const ASK = {
	requestId: "req-1",
	toolName: "Bash",
	description: "Run shell command",
	inputPreview: "{}",
};

export const calls = (o: Owner) => (o === A ? 3 : 5);

// Todo lo que cada adaptador de cada proyecto necesita, sobre una base con los dos proyectos sembrados
export function world(file: string) {
	const raw = openTestDb(file, { projects: [A.id, B.id] });
	let clock = Date.now() - 1_000_000;
	const now = () => (clock += 10);
	const per = (o: Owner) => {
		const db = (queryOnly = false) =>
			openTestDb(file, { projects: [A.id, B.id], queryOnly });
		return {
			log: new SqliteActivityLog({
				projectId: o.id,
				db: db(),
				warn: (m) => assert.fail(m),
			}),
			attemptLog: new SqliteAttemptLog({
				projectId: o.id,
				db: db(),
				warn: (m) => assert.fail(m),
				maxScriptBytes: () => 1000,
			}),
			query: new SqliteHistoryQuery({ projectId: o.id, db: db(true) }),
			source: new SqliteActivitySource({
				projectId: o.id,
				db: db(true),
				pollMs: 1,
			}),
			chatMailbox: new SqliteChatMailbox({ projectId: o.id, db: db(), now }),
			chatPanel: new SqliteChatPanel({
				projectId: o.id,
				db: db(),
				now,
				isAlive: () => true,
			}),
			permMailbox: new SqlitePermissionMailbox({
				projectId: o.id,
				db: db(),
				now,
			}),
			permPanel: new SqlitePermissionPanel({
				projectId: o.id,
				db: db(),
				now,
				isAlive: () => true,
			}),
			cancelMailbox: new SqliteCancelMailbox({
				projectId: o.id,
				db: db(),
				now,
			}),
			cancelPanel: new SqliteCancelPanel({
				projectId: o.id,
				db: db(),
				now,
				isAlive: () => true,
			}),
		};
	};
	const forA = per(A);
	const forB = per(B);
	const of = (o: Owner) => (o === A ? forA : forB);

	// Siembra: los mismos ids en los dos, distinto contenido y distinto número de llamadas
	for (const o of OWNERS) {
		const { log, chatMailbox, permMailbox } = of(o);
		const t = o.tag;
		log.record(
			sessionStarted(
				SHARED_SESSION,
				0,
				`https://www.figma.com/design/${t}/${t}`,
			),
		);
		log.record(statusChecked(SHARED_SESSION, 1));
		for (let i = 1; i <= calls(o); i++) {
			const id = `c${i}`;
			log.record(
				toolCalled(
					SHARED_SESSION,
					id,
					"figma_run_script",
					{ file: `scripts/pintar-${t}${i}.js` },
					100 * i,
				),
			);
			const failed = i === 2;
			log.record(
				toolFinished(SHARED_SESSION, id, 100 * i + 50, {
					ms: 50,
					touchedNodeIds: i === 1 ? ["1:1", `${t}:solo`] : [],
					...(failed && { ok: false, error: scriptError(`Boom-${t}`) }),
					...(i === 3 && { jobId: "job-1" }),
				}),
			);
		}
		log.record(
			screenshotSaved(
				SHARED_SESSION,
				"c1",
				150,
				"1:1",
				`/out/${t}/captura.png`,
			),
		);
		log.record(
			buildStepFinished(SHARED_SESSION, "job-1", 400, {
				index: 0,
				file: `build-${t}.js`,
				result: { kind: "inline", json: JSON.stringify({ dueño: t }) },
			}),
		);
		log.record(
			jobFinished(SHARED_SESSION, "job-1", 500, {
				touchedNodeIds: [`${t}:job`],
			}),
		);
		// Un lote terminado con un paso (mismo job y mismo índice en los dos proyectos, distinto resultado)
		log.record(toolCalled(SHARED_SESSION, "cs", "figma_build", {}, 550));
		log.record(toolFinished(SHARED_SESSION, "cs", 560, { jobId: "job-lote" }));
		log.record(
			buildStepFinished(SHARED_SESSION, "job-lote", 570, {
				index: 0,
				file: `lote-${t}.js`,
				result: { kind: "inline", json: JSON.stringify({ lote: t }) },
			}),
		);
		log.record(jobFinished(SHARED_SESSION, "job-lote", 580));
		// Un job que sigue en marcha (cancelable) con un id solo suyo
		log.record(toolCalled(SHARED_SESSION, "cb", "figma_build", {}, 600));
		log.record(
			toolFinished(SHARED_SESSION, "cb", 610, { jobId: `job-${t}-vivo` }),
		);
		// Dos intentos del MISMO objetivo y del mismo número en los dos proyectos, con contenido distinto
		for (const n of [1, 2]) {
			of(o).attemptLog.record({
				kind: "run_script",
				target: "pasos/mismo.js",
				callId: "c1",
				startedAt: new Date(100 * n),
				finishedAt: new Date(100 * n + 10),
				status: "ok",
				kit: "figma-kit@1",
				scripts: [
					{ role: "step", path: "", content: `paso-${t}-${n}` },
					{ role: "params", path: "", content: `{"dueño":"${t}"}` },
					{ role: "kit", path: "", content: "kit" },
				],
			});
		}
		chatMailbox.register(creds(o));
		permMailbox.record(creds(o), { ...ASK, description: `Pide ${t}` });
		of(o).chatPanel.send({ ...creds(o), text: `hola-${t}` });
	}
	return { file, raw, of };
}
