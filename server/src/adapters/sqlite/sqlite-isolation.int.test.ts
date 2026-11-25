// CA-5: con dos proyectos en la MISMA base, ninguna lectura ni escritura de uno toca una fila del otro. Los dos
// comparten a propósito sesión, llamadas, job, nodos, id de petición y búsquedas (las claves se repiten entre proyectos
// y lo único que los separa es el proyecto); lo que cambia es el texto, que lleva la marca de su dueño.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { CallsQuery } from "#domain/history.ts";
import type { FigmaDb } from "./database.ts";
import { SqliteHistoryQuery } from "./sqlite-history-query.ts";
import { openTestDb } from "./testing/projects.ts";
import {
	A,
	ALL,
	B,
	calls,
	creds,
	OWNERS,
	other,
	SHARED_SESSION,
	token,
	world as worldIn,
} from "./testing/two-projects.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-aislamiento-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const world = () => worldIn(join(dir, `w${++n}.db`));

const query = (over: Partial<CallsQuery> = {}): CallsQuery => ({
	range: ALL,
	tool: null,
	status: "all",
	search: "",
	jobsOnly: false,
	sort: { key: "time", dir: "asc" },
	page: 1,
	perPage: 100,
	locate: null,
	...over,
});
const text = (value: unknown): string => JSON.stringify(value);
const count = (db: FigmaDb, table: string, projectId: number): number =>
	(
		db.$client
			.prepare(`SELECT count(*) AS n FROM ${table} WHERE project_id = ?`)
			.get(projectId) as { n: number }
	).n;

describe("aislamiento entre proyectos: lecturas del histórico (SqliteHistoryQuery)", () => {
	for (const o of OWNERS) {
		const x = o.tag;
		const y = other(o).tag;
		describe(`el proyecto ${x} no ve nada del ${y}`, () => {
			it("summary cuenta solo lo suyo", () => {
				const { of } = world();
				const s = of(o).query.summary(ALL, 10);
				assert.equal(s.calls, calls(o) + 2);
				assert.equal(s.errors, 1);
				assert.equal(s.jobs, 3);
				assert.equal(s.nodesTouched, 3);
				assert.doesNotMatch(text(s), new RegExp(`${y}:`));
			});

			it("errors, nodes y sessions solo traen lo suyo", () => {
				const { of } = world();
				const { query } = of(o);
				const errors = query.errors(ALL, 10);
				assert.equal(errors.total, 1);
				assert.match(text(errors), new RegExp(`Boom-${x}`));
				assert.doesNotMatch(text(errors), new RegExp(`Boom-${y}`));
				const nodes = query.nodes(ALL, 50);
				assert.deepEqual(
					nodes.items.map((i) => i.nodeId).sort(),
					["1:1", `${x}:job`, `${x}:solo`].sort(),
				);
				assert.equal(nodes.total, 3);
				const sessions = query.sessions(ALL, 50);
				assert.equal(sessions.total, 1);
				assert.equal(sessions.items[0]?.sessionId, SHARED_SESSION);
				assert.equal(sessions.items[0]?.calls, calls(o) + 2);
				assert.match(sessions.items[0]?.fileUrl ?? "", new RegExp(`/${x}/`));
			});

			it("calls lista, filtra, ordena y localiza solo dentro del proyecto", () => {
				const { of } = world();
				const { query } = of(o);
				const page = query.calls(query_());
				assert.equal(page.total, calls(o) + 2);
				assert.doesNotMatch(text(page), new RegExp(`pintar-${y}`));
				assert.equal(query.calls(query_({ status: "error" })).total, 1);
				assert.equal(query.calls(query_({ jobsOnly: true })).total, 3);
				assert.equal(
					query.calls(query_({ tool: "figma_run_script" })).total,
					calls(o),
				);
				const located = query.calls(query_({ locate: "c3", perPage: 2 }));
				assert.equal(located.page, 2);
			});

			it("la búsqueda de texto (FTS5) no cruza proyectos: ni por ruta, ni por error, ni por nodo", () => {
				const { of } = world();
				const { query } = of(o);
				const ids = (search: string) =>
					query.calls(query_({ search })).items.map((c) => c.callId);
				assert.deepEqual(ids(`pintar-${y}1`), []);
				assert.deepEqual(ids(`Boom-${y}`), []);
				assert.deepEqual(ids(`${y}:solo`), []);
				assert.deepEqual(ids(`Boom-${x}`), ["c2"]);
				assert.deepEqual(ids(`pintar-${x}1`), ["c1"]);
				assert.equal(ids("figma_run_script").length, calls(o));
			});

			it("call(id) devuelve la suya aunque el otro proyecto tenga el mismo id, y steps/captures/lastStatus también", () => {
				const { of } = world();
				const { query } = of(o);
				const call = query.call("c1");
				assert.match(call?.summary ?? "", new RegExp(`pintar-${x}1`));
				assert.equal(call?.screenshots[0]?.path, `/out/${x}/captura.png`);
				if (o === A) assert.equal(query.call("c4"), null);
				const steps = query.steps("job-1");
				assert.equal(steps.length, 1);
				assert.equal(steps[0]?.file, `build-${x}.js`);
				assert.deepEqual(steps[0]?.result, {
					kind: "inline",
					value: { dueño: x },
				});
				assert.deepEqual(query.steps(`job-${y}-vivo`), []);
				const shots = query.captures(1, 50);
				assert.equal(shots.total, 1);
				assert.equal(shots.items[0]?.shot.path, `/out/${x}/captura.png`);
				assert.equal(query.lastStatus()?.fileName, "Archivo");
			});
		});
	}

	it("lastStatus es del proyecto: uno sin status_checked da null aunque el otro lo tenga", () => {
		const { file } = world();
		openTestDb(file, { projects: [A.id, B.id, 3] });
		const lonely = new SqliteHistoryQuery({
			projectId: 3,
			db: openTestDb(file, { queryOnly: true }),
		});
		assert.equal(lonely.lastStatus(), null);
		assert.equal(lonely.summary(ALL, 5).calls, 0);
		assert.equal(lonely.captures(1, 10).total, 0);
	});
});

const query_ = query;

describe("aislamiento entre proyectos: el tiempo real y el mantenimiento", () => {
	for (const o of OWNERS) {
		it(`el proyecto ${o.tag} lee solo sus eventos, con su propio cursor`, () => {
			const { of } = world();
			const { source } = of(o);
			const events = source.readAfter(0, 10_000);
			assert.ok(events.length > 0);
			assert.doesNotMatch(text(events), new RegExp(`pintar-${other(o).tag}`));
			assert.match(text(events), new RegExp(`pintar-${o.tag}1`));
			assert.equal(source.latestId(), events.at(-1)?.id);
			assert.deepEqual(source.readAfter(source.latestId(), 10), []);
		});
	}

	for (const o of OWNERS) {
		it(`los intentos del proyecto ${o.tag}: objetivos, intentos, los de una llamada y sus contenidos son solo suyos`, () => {
			const { of } = world();
			const { query } = of(o);
			const y = other(o).tag;
			const targets = query.attemptTargets({
				target: null,
				kind: null,
				sinceMs: null,
				limit: 10,
			});
			assert.equal(targets.total, 1);
			assert.equal(targets.items[0]?.attempts, 2);
			const items = query.attempts({
				target: "mismo",
				kind: null,
				sinceMs: null,
				limit: 10,
			});
			assert.deepEqual(
				items.items.map((i) => i.n),
				[1, 2],
			);
			assert.equal(query.attemptsOfCall("c1").length, 2);
			const step = query.storedScript({
				by: "attempt",
				attemptId: items.items[0]?.id ?? 0,
				role: "step",
			});
			assert.equal(
				step.kind === "found" && step.script.content,
				`paso-${o.tag}-1`,
			);
			// El hash de un contenido del otro proyecto no existe aquí
			const theirs = of(other(o)).query.attempts({
				target: "mismo",
				kind: null,
				sinceMs: null,
				limit: 10,
			});
			const theirSha =
				theirs.items[0]?.scripts.find((s) => s.role === "step")?.sha256 ?? "";
			assert.deepEqual(query.storedScript({ by: "sha256", sha256: theirSha }), {
				kind: "not_found",
			});
			assert.doesNotMatch(text(items), new RegExp(`paso-${y}`));
		});
	}

	for (const o of OWNERS) {
		it(`las consultas de la página «Intentos» del proyecto ${o.tag} no ven al otro: objetivo exacto, por id y último estado`, () => {
			const { of } = world();
			const { query } = of(o);
			const theirs = of(other(o)).query;
			const exact = {
				kind: "run_script",
				target: "pasos/mismo.js",
				offset: 0,
				limit: 10,
			} as const;
			const mine = query.targetAttempts(exact);
			assert.equal(mine.total, 2);
			assert.doesNotMatch(text(mine), new RegExp(`paso-${other(o).tag}`));
			const theirIds = theirs.targetAttempts(exact).items;
			assert.ok(theirIds.length > 0);
			for (const item of theirIds) {
				assert.equal(
					query.attemptById(item.id),
					null,
					"un id del otro: no existe",
				);
			}
			const targets = query.attemptTargets({
				target: null,
				kind: null,
				sinceMs: null,
				limit: 10,
				status: "ok",
				offset: 0,
			});
			assert.equal(targets.total, 1);
		});
	}

	it("podar un proyecto no borra nada del otro", () => {
		const { of, raw } = world();
		const before = {
			calls: count(raw, "calls", B.id),
			events: count(raw, "events", B.id),
			sessions: count(raw, "sessions", B.id),
		};
		const pruned = of(A).log.prune(new Date(Date.now() + 1_000_000));
		assert.ok(pruned.calls > 0);
		assert.equal(count(raw, "calls", A.id), 0);
		assert.deepEqual(
			{
				calls: count(raw, "calls", B.id),
				events: count(raw, "events", B.id),
				sessions: count(raw, "sessions", B.id),
			},
			before,
		);
	});

	it("podar un proyecto borra sus intentos (menos el último ok) y sus contenidos; los del otro quedan", () => {
		const { of, raw } = world();
		const before = {
			attempts: count(raw, "attempts", B.id),
			scripts: count(raw, "attempt_scripts", B.id),
			blobs: count(raw, "script_blobs", B.id),
		};
		of(A).log.prune(new Date(Date.now() + 1_000_000));
		assert.equal(count(raw, "attempts", A.id), 1, "el último ok se protege");
		assert.deepEqual(
			{
				attempts: count(raw, "attempts", B.id),
				scripts: count(raw, "attempt_scripts", B.id),
				blobs: count(raw, "script_blobs", B.id),
			},
			before,
		);
	});

	it("interrumpir los jobs de una sesión (el mismo id de sesión en los dos) solo cierra los del proyecto", () => {
		const { of, raw } = world();
		const running = (p: number) =>
			(
				raw.$client
					.prepare(
						"SELECT count(*) AS n FROM jobs WHERE project_id = ? AND status = 'running'",
					)
					.get(p) as { n: number }
			).n;
		assert.equal(running(A.id), 1);
		assert.equal(running(B.id), 1);
		assert.equal(
			of(A).log.interruptSessionJobs(SHARED_SESSION, "adiós", new Date()),
			1,
		);
		assert.equal(running(A.id), 0);
		assert.equal(running(B.id), 1);
		assert.equal(
			of(B).log.interruptDeadSessionJobs({
				ownSessionId: "otra",
				isAlive: () => false,
				reason: "muerta",
				at: new Date(),
			}),
			1,
		);
		assert.equal(running(B.id), 0);
	});

	it("la marca de «ya importado» es del proyecto: importar en uno no impide importarlo en el otro", () => {
		const { of } = world();
		assert.equal(of(A).log.importOnce("activity.jsonl", []).status, "imported");
		assert.equal(
			of(A).log.importOnce("activity.jsonl", []).status,
			"already-imported",
		);
		assert.equal(of(B).log.importOnce("activity.jsonl", []).status, "imported");
	});

	it("borrar un proyecto borra todo su histórico (también el índice de texto) y deja el del otro intacto", () => {
		const { raw, of } = world();
		const tables = [
			"sessions",
			"events",
			"calls",
			"jobs",
			"build_steps",
			"call_nodes",
			"nodes_touched",
			"captures",
			"chat_messages",
			"permission_requests",
			"cancel_requests",
			"attempts",
			"attempt_scripts",
			"script_blobs",
		];
		// Una cancelación pedida en cada proyecto, para que también esa tabla tenga filas
		for (const o of OWNERS) {
			assert.ok(of(o).cancelPanel.request(`job-${o.tag}-vivo`).ok);
		}
		const before = Object.fromEntries(
			tables.map((t) => [t, count(raw, t, B.id)]),
		);
		for (const t of tables) assert.ok(count(raw, t, A.id) > 0, `${t} sembrada`);
		raw.$client.prepare("DELETE FROM projects WHERE id = ?").run(A.id);
		for (const t of tables) {
			assert.equal(count(raw, t, A.id), 0, `${t} del proyecto borrado`);
			assert.equal(count(raw, t, B.id), before[t], `${t} del otro proyecto`);
		}
		const fts = (q: string) =>
			(
				raw.$client
					.prepare(
						"SELECT count(*) AS n FROM calls_fts WHERE calls_fts MATCH ?",
					)
					.get(q) as { n: number }
			).n;
		assert.equal(fts("pintar"), calls(B));
		assert.equal(fts("A1"), 0);
		assert.equal(
			of(B).chatPanel.search(SHARED_SESSION, "hola", 10).items.length,
			1,
		);
	});
});

describe("aislamiento entre proyectos: chat, permisos y cancelaciones", () => {
	for (const o of OWNERS) {
		const x = o.tag;
		const y = other(o).tag;
		describe(`el proyecto ${x} no ve nada del ${y}`, () => {
			it("el chat: sesiones, mensajes, páginas y búsqueda son suyos", () => {
				const { of } = world();
				const { chatPanel } = of(o);
				const sessions = chatPanel.sessions();
				assert.equal(sessions.length, 1);
				const messages = chatPanel.messages(SHARED_SESSION, 0, 50);
				assert.deepEqual(
					messages.map((m) => m.body),
					[`hola-${x}`],
				);
				assert.deepEqual(
					chatPanel.page(SHARED_SESSION, null, 50).items.map((m) => m.body),
					[`hola-${x}`],
				);
				assert.deepEqual(
					chatPanel.search(SHARED_SESSION, `hola-${y}`, 10).items,
					[],
				);
				assert.equal(
					chatPanel.search(SHARED_SESSION, "hola", 10).items.length,
					1,
				);
			});

			it("el token de la sesión del otro proyecto no vale aquí aunque la sesión se llame igual", () => {
				const { of } = world();
				const sent = of(o).chatPanel.send({
					sessionId: SHARED_SESSION,
					token: token(other(o)),
					text: "colado",
				});
				assert.ok(!sent.ok);
				assert.equal(sent.error.type, "InvalidToken");
			});

			it("la sesión solo recoge los mensajes de su proyecto y no puede contestar a una conversación ajena", () => {
				const { of } = world();
				const { chatMailbox } = of(o);
				const pending = chatMailbox.pending(creds(o));
				assert.deepEqual(
					pending.map((m) => m.body),
					[`hola-${x}`],
				);
				const foreignChat =
					of(other(o)).chatPanel.messages(SHARED_SESSION, 0, 5)[0]?.chatId ??
					"";
				const reply = chatMailbox.reply(creds(o), foreignChat, "intruso");
				assert.ok(!reply.ok);
				assert.equal(reply.error.type, "NoSuchChat");
				chatMailbox.markDelivered(creds(o), pending[0]?.id ?? 0);
			});

			it("los permisos: la lista y los veredictos son suyos y no se puede decidir una petición ajena", () => {
				const { of } = world();
				const { permPanel, permMailbox } = of(o);
				const list = permPanel.list(SHARED_SESSION, 10);
				assert.deepEqual(
					list.map((r) => r.description),
					[`Pide ${x}`],
				);
				const foreign = of(other(o)).permPanel.list(SHARED_SESSION, 10)[0];
				assert.ok(foreign);
				const decided = permPanel.decide({
					sessionId: SHARED_SESSION,
					token: token(o),
					id: foreign.id,
					behavior: "allow",
				});
				assert.ok(!decided.ok);
				assert.equal(decided.error.type, "NoSuchRequest");
				assert.deepEqual(permMailbox.verdicts(creds(o)), []);
				const own = permPanel.decide({
					sessionId: SHARED_SESSION,
					token: token(o),
					id: list[0]?.id ?? 0,
					behavior: "allow",
				});
				assert.ok(own.ok);
				assert.equal(
					of(other(o)).permPanel.list(SHARED_SESSION, 10)[0]?.status,
					"pending",
				);
				assert.equal(permMailbox.verdicts(creds(o)).length, 1);
				assert.deepEqual(
					of(other(o)).permMailbox.verdicts(creds(other(o))),
					[],
				);
			});

			it("las cancelaciones: un job del otro proyecto no existe aquí y la bandeja solo trae las suyas", () => {
				const { of } = world();
				const { cancelPanel, cancelMailbox } = of(o);
				assert.equal(cancelPanel.stateOf(`job-${y}-vivo`), null);
				const refused = cancelPanel.request(`job-${y}-vivo`);
				assert.ok(!refused.ok);
				assert.equal(refused.error.type, "NoSuchJob");
				assert.equal(cancelPanel.stateOf(`job-${x}-vivo`), "available");
				assert.ok(cancelPanel.request(`job-${x}-vivo`).ok);
				assert.deepEqual(
					cancelMailbox.pending(SHARED_SESSION).map((r) => r.jobId),
					[`job-${x}-vivo`],
				);
				assert.equal(
					of(other(o)).cancelPanel.stateOf(`job-${y}-vivo`),
					"available",
				);
				assert.deepEqual(
					of(other(o)).cancelMailbox.pending(SHARED_SESSION),
					[],
				);
			});
		});
	}
});
