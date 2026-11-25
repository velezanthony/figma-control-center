// E19 proyectos en caliente: un proyecto dado de alta en el panel se sirve sin reiniciarlo, uno borrado deja de
// servirse y el proyecto del .env sale en la lista. Panel real + registro en disco, sin Figma ni Chrome.
import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { E2E_PROJECT_ID } from "../../harness/env.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const NOT_FOUND = 404;
const OK = 200;

type ListedProject = { id: string; name: string };

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

const post = (path: string, body: unknown) =>
	fetch(`${env.dashboardUrl}${path}`, {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify(body),
	});
const summaryOf = (project: string) =>
	fetch(`${env.dashboardUrl}/api/history/summary?project=${project}`);
const listed = async () =>
	(await env.api<{ entries: ListedProject[] }>("/api/projects/list")).entries;

describe("E19 · proyectos en caliente", () => {
	it("un proyecto dado de alta se sirve sin reiniciar el panel y uno borrado deja de servirse", async () => {
		env = await startEnvironment({ dashboard: true, figma: "down" });
		const saved = await post("/api/projects/save", {
			entry: {
				name: "Otro",
				projectDir: env.dir,
				fileUrl: "https://www.figma.com/design/OTRO/Otro",
				outputDir: join(env.dir, "otro-salida"),
			},
		});
		assert.equal(saved.status, OK);
		const added = (await listed()).find((p) => p.name === "Otro");
		assert.ok(added, "el proyecto nuevo sale en la lista");

		assert.equal((await summaryOf(added.id)).status, OK);

		await post("/api/projects/delete", { id: added.id });
		assert.equal((await summaryOf(added.id)).status, NOT_FOUND);
	});

	it("el proyecto del entorno sale de su registro, sin marca de «del .env», y se sirve", async () => {
		env = await startEnvironment({ dashboard: true, figma: "down" });
		const entries = await listed();
		assert.deepEqual(
			entries.map((p) => p.id),
			[E2E_PROJECT_ID],
		);
		assert.equal("isDefault" in (entries[0] ?? {}), false);
		assert.equal((await summaryOf(E2E_PROJECT_ID)).status, OK);
	});
});
