// E46 ids de proyecto: la base da 1, 2, 3…; un id borrado no vuelve; las carpetas numéricas que ya existen en la salida
// se respetan; el id es el trozo de la carpeta y el de ?project=. Panel real, sin Figma ni Chrome.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const OK = 200;
const NOT_FOUND = 404;
const BAD_REQUEST = 400;

type Listed = {
	entries: { id: string; name: string; outputDir?: string }[];
};

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
const entry = (name: string) => ({
	name,
	projectDir: env.dir,
	fileUrl: `https://www.figma.com/design/${name}/${name}`,
});
const alta = async (name: string): Promise<void> => {
	assert.equal(
		(await post("/api/projects/save", { entry: entry(name) })).status,
		OK,
	);
};
const listed = async () =>
	(await env.api<Listed>("/api/projects/list")).entries;

describe("E46 · ids de proyecto", () => {
	it("el alta da 1, 2, 3; borrar el 3 y dar de alta otro da el 4, y la carpeta y ?project usan el número", async () => {
		env = await startEnvironment({ figma: "down", projects: [] });
		for (const name of ["A", "B", "C"]) await alta(name);
		assert.deepEqual(
			(await listed()).map((p) => p.id),
			["1", "2", "3"],
		);
		await post("/api/projects/delete", { id: "3" });
		await alta("D");
		const entries = await listed();
		assert.deepEqual(
			entries.map((p) => p.id),
			["1", "2", "4"],
		);
		const outputDir = join(env.dir, "salida");
		assert.equal(entries[2]?.outputDir, join(outputDir, "4"));
		const summary = await fetch(
			`${env.dashboardUrl}/api/history/summary?project=4`,
		);
		assert.equal(summary.status, OK);
		const gone = await fetch(
			`${env.dashboardUrl}/api/history/summary?project=3`,
		);
		assert.equal(gone.status, NOT_FOUND);
	});

	it("con carpetas numéricas ya en la salida (restos de una base borrada a mano), el id las supera", async () => {
		env = await startEnvironment({
			figma: "down",
			prepareDb: (file) =>
				mkdir(join(dirname(file), "salida", "7"), { recursive: true }).then(
					() => undefined,
				),
		});
		await alta("A");
		assert.deepEqual(
			(await listed()).map((p) => p.id),
			["8"],
		);
	});

	it("un alta con id propio o con un id con símbolos se rechaza y no crea nada", async () => {
		env = await startEnvironment({ figma: "down", projects: [] });
		const own = await post("/api/projects/save", {
			entry: { ...entry("A"), id: "5" },
		});
		assert.equal(own.status, NOT_FOUND);
		for (const id of ["../..", "a/b", "9bd5548d-835d-47bf-88c8-3e84fb4dd806"]) {
			const bad = await post("/api/projects/save", {
				entry: { ...entry("A"), id },
			});
			assert.equal(bad.status, BAD_REQUEST, id);
		}
		assert.deepEqual(await listed(), []);
	});
});
