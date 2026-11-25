import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import {
	SqliteCancelMailbox,
	SqliteCancelPanel,
} from "./sqlite-cancel-requests.ts";
import {
	jobFinished,
	sessionStarted,
	toolCalled,
	toolFinished,
} from "./testing/events.ts";
import { openTestDb, PROJECT_ID } from "./testing/projects.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-cancel-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const S = "sesion-a";
const OTHER = "sesion-b";

function setup(alive: (pid: number) => boolean = () => true) {
	const file = join(dir, `c${++n}.db`);
	const log = new SqliteActivityLog({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		warn: (m) => assert.fail(m),
	});
	log.record(sessionStarted(S, 0));
	log.record(sessionStarted(OTHER, 0));
	const launch = (session: string, call: string, tool: string, job: string) => {
		log.record(toolCalled(session, call, tool, {}, 10));
		log.record(toolFinished(session, call, 20, { jobId: job }));
	};
	return {
		log,
		launch,
		panel: new SqliteCancelPanel({
			projectId: PROJECT_ID,
			db: openTestDb(file),
			isAlive: alive,
		}),
		mailbox: new SqliteCancelMailbox({
			projectId: PROJECT_ID,
			db: openTestDb(file),
		}),
	};
}

describe("SqliteCancelPanel.stateOf", () => {
	it("un job que no existe da null", () => {
		assert.equal(setup().panel.stateOf("nada"), null);
	});

	it("un lote en marcha de una sesión viva se puede cancelar", () => {
		const { panel, launch } = setup();
		launch(S, "c1", "figma_build", "job-1");
		assert.equal(panel.stateOf("job-1"), "available");
	});

	it("un job terminado no se puede cancelar", () => {
		const { panel, launch, log } = setup();
		launch(S, "c1", "figma_build", "job-1");
		log.record(jobFinished(S, "job-1", 100, { status: "done" }));
		assert.equal(panel.stateOf("job-1"), "finished");
	});

	it("un figma_run_script suelto no se puede cancelar", () => {
		const { panel, launch } = setup();
		launch(S, "c1", "figma_run_script", "job-1");
		assert.equal(panel.stateOf("job-1"), "notBatch");
	});

	it("si la sesión dueña ya no está viva, no se puede cancelar", () => {
		const { panel, launch } = setup(() => false);
		launch(S, "c1", "figma_build", "job-1");
		assert.equal(panel.stateOf("job-1"), "sessionGone");
	});

	it("tras pedir la cancelación queda «requested», también cuando la sesión ya la recogió", () => {
		const { panel, launch, mailbox } = setup();
		launch(S, "c1", "figma_build", "job-1");
		const asked = panel.request("job-1");
		assert.ok(asked.ok);
		assert.equal(panel.stateOf("job-1"), "requested");
		mailbox.markHandled(S, asked.value.id);
		assert.equal(panel.stateOf("job-1"), "requested");
	});
});

describe("SqliteCancelPanel.request", () => {
	it("pedirla dos veces o sobre un job que no se puede cancelar es un error con su motivo", () => {
		const { panel, launch } = setup();
		launch(S, "c1", "figma_build", "job-1");
		launch(S, "c2", "figma_run_script", "job-2");
		assert.ok(panel.request("job-1").ok);
		const again = panel.request("job-1");
		assert.ok(!again.ok && again.error.type === "NotCancellable");
		assert.equal(again.error.state, "requested");
		const script = panel.request("job-2");
		assert.ok(!script.ok && script.error.type === "NotCancellable");
		assert.equal(script.error.state, "notBatch");
		const missing = panel.request("nada");
		assert.ok(!missing.ok && missing.error.type === "NoSuchJob");
	});
});

describe("SqliteCancelMailbox", () => {
	it("cada sesión solo ve las peticiones de sus jobs y una recogida deja de estar pendiente", () => {
		const { panel, launch, mailbox } = setup();
		launch(S, "c1", "figma_build", "job-1");
		launch(OTHER, "c2", "figma_build", "job-2");
		panel.request("job-1");
		panel.request("job-2");
		const mine = mailbox.pending(S);
		assert.deepEqual(
			mine.map((r) => r.jobId),
			["job-1"],
		);
		mailbox.markHandled(S, mine[0]?.id ?? 0);
		assert.deepEqual(mailbox.pending(S), []);
		assert.equal(mailbox.pending(OTHER).length, 1);
	});
});
