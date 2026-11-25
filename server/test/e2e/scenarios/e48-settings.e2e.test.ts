// E48 ajustes del panel: lo guardado en la base cambia el valor efectivo, el entorno lo sobrescribe, y un ajuste que no
// vale se avisa sin tumbar el arranque. Panel real con la base única, sin Figma ni Chrome.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteSettings } from "#adapters/sqlite/sqlite-settings.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { addProjects } from "../../harness/projects.ts";
import { until } from "../../harness/wait.ts";

type Listed = {
	ok: boolean;
	settings: {
		key: string;
		stored: string | null;
		effective: unknown;
		origin: string;
		default: unknown;
		running: unknown;
		group: string;
		name: string;
		help: string;
		unit: string;
		usedBy: string[];
	}[];
	problems: string[];
};

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

const withSettings =
	(values: Record<string, string>) =>
	async (file: string): Promise<void> => {
		await addProjects(file, `${file}.salida`, []);
		const db = openFigmaDatabase(file);
		try {
			const settings = new SqliteSettings({ db });
			for (const [key, value] of Object.entries(values))
				settings.set(key, value);
		} finally {
			db.$client.close();
		}
	};

describe("E48 · ajustes del panel", () => {
	it("el endpoint dice, de cada ajuste editable, lo guardado, lo efectivo y de dónde viene", async () => {
		env = await startEnvironment({
			figma: "down",
			prepareDb: withSettings({
				FCC_HISTORY_STEP_EXCERPT_BYTES: "77",
				FCC_BUILD_MAX_STEPS: "12",
			}),
			extraEnv: { FCC_BUILD_MAX_STEPS: "30" },
		});
		const listed = await env.api<Listed>("/api/settings/list");
		const by = Object.fromEntries(listed.settings.map((s) => [s.key, s]));
		const core = (key: string) => {
			const s = by[key];
			return (
				s && {
					key: s.key,
					stored: s.stored,
					effective: s.effective,
					origin: s.origin,
					default: s.default,
					running: s.running,
				}
			);
		};
		assert.deepEqual(core("FCC_HISTORY_STEP_EXCERPT_BYTES"), {
			key: "FCC_HISTORY_STEP_EXCERPT_BYTES",
			stored: "77",
			effective: 77,
			origin: "panel",
			default: 300,
			// Lo guardado ya estaba al arrancar el panel: corre con ello
			running: 77,
		});
		assert.deepEqual(core("FCC_BUILD_MAX_STEPS"), {
			key: "FCC_BUILD_MAX_STEPS",
			stored: "12",
			effective: 30,
			origin: "env",
			default: 50,
			running: 30,
		});
		// La ficha llega con cada ajuste: la pantalla pinta lo que recibe
		const excerpt = by["FCC_HISTORY_STEP_EXCERPT_BYTES"];
		assert.equal(excerpt?.group, "Histórico");
		assert.equal(excerpt?.unit, "bytes");
		assert.deepEqual(excerpt?.usedBy, ["panel", "agent"]);
		assert.ok(excerpt?.name);
		assert.ok(excerpt?.help);
		assert.equal(by["FCC_MAX_PARAMS_BYTES"]?.origin, "default");
		assert.deepEqual(listed.problems, []);
		// Los de arranque no salen: no se editan desde aquí
		assert.equal(by["FCC_DB"], undefined);
		assert.equal(by["FIGMA_CDP_PORT"], undefined);
	});

	it("un ajuste guardado que no vale (de arranque, desconocido o inválido) se avisa por stderr y no tumba el panel", async () => {
		env = await startEnvironment({
			figma: "down",
			prepareDb: withSettings({
				FIGMA_CDP_PORT: "1234",
				FCC_NO_EXISTE: "1",
				FCC_LIVE_POLL_MS: "abc",
			}),
		});
		await until("el panel avisó de los tres", () =>
			["FIGMA_CDP_PORT", "FCC_NO_EXISTE", "FCC_LIVE_POLL_MS"].every((k) =>
				env.dashboardOutput().includes(k),
			),
		);
		const listed = await env.api<Listed>("/api/settings/list");
		assert.equal(listed.problems.length, 3);
		const poll = listed.settings.find((s) => s.key === "FCC_LIVE_POLL_MS");
		assert.equal(poll?.origin, "env");
	});
});
