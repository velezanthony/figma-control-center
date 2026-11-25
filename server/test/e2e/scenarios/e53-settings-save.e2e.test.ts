// E53 guardar y restablecer ajustes contra el panel real del arnés: lo guardado cambia el
// efectivo y queda en la base, restablecer borra solo esa clave, lo que fija el entorno no se toca (409) y una petición
// que no viene del panel no escribe nada. Sin Figma ni Chrome, y sin ningún proyecto dado de alta.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";

type Setting = {
	key: string;
	stored: string | null;
	effective: unknown;
	origin: string;
	default: unknown;
	running: unknown;
};
type Reply = {
	status: number;
	body: {
		ok: boolean;
		settings?: Setting[];
		problems?: string[];
		error?: { type: string; message: string };
	};
};

// El entorno del arnés ya fija algunas claves editables (FCC_HISTORY_MAX_ROWS, FCC_LIVE_POLL_MS…: testEnv); las
// pruebas de guardar usan una que deja libre y que usa el panel
let env: Environment;
afterEach(async () => {
	await env?.stop();
});

const start = (extraEnv: Record<string, string> = {}) =>
	startEnvironment({ figma: "down", projects: [], extraEnv });

async function post(
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Reply> {
	const response = await fetch(`${env.dashboardUrl}${path}`, {
		method: "POST",
		headers: {
			Origin: env.dashboardUrl,
			"Content-Type": "application/json",
			...headers,
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
	return {
		status: response.status,
		body: (await response.json()) as Reply["body"],
	};
}

const storedRows = () =>
	Object.fromEntries(
		env
			.rows<{ key: string; value: string }>(
				"SELECT key, value FROM settings ORDER BY key",
			)
			.map((r) => [r.key, r.value]),
	);
const settingIn = (reply: Reply, key: string) =>
	reply.body.settings?.find((s) => s.key === key);

describe("E53 · guardar y restablecer ajustes", () => {
	it("guardar un valor válido lo deja en la base (como lo lee zod) y el listado lo da como guardado en el panel", async () => {
		env = await start();
		const saved = await post("/api/settings/save", {
			key: "FCC_HISTORY_STEP_EXCERPT_BYTES",
			value: " 77 ",
		});
		assert.equal(saved.status, 200);
		assert.deepEqual(storedRows(), { FCC_HISTORY_STEP_EXCERPT_BYTES: "77" });
		const row = settingIn(saved, "FCC_HISTORY_STEP_EXCERPT_BYTES");
		assert.equal(row?.origin, "panel");
		assert.equal(row?.effective, 77);
		// Lo usa el panel, que arrancó con el valor por defecto: hasta reiniciarlo no se aplica
		assert.equal(row?.running, 300);
		const listed = await env.api<Reply["body"]>("/api/settings/list");
		assert.equal(
			listed.settings?.find((s) => s.key === "FCC_HISTORY_STEP_EXCERPT_BYTES")
				?.stored,
			"77",
		);
	});

	it("al reiniciar el panel, arranca con lo guardado", async () => {
		env = await start();
		await post("/api/settings/save", {
			key: "FCC_HISTORY_STEP_EXCERPT_BYTES",
			value: "900",
		});
		await env.killDashboard("SIGTERM");
		await env.restartDashboard();
		const listed = await env.api<Reply["body"]>("/api/settings/list");
		const excerpt = listed.settings?.find(
			(s) => s.key === "FCC_HISTORY_STEP_EXCERPT_BYTES",
		);
		assert.equal(excerpt?.running, 900);
		assert.equal(excerpt?.effective, 900);
	});

	it("restablecer borra solo ese ajuste y vuelve al valor por defecto", async () => {
		env = await start();
		await post("/api/settings/save", {
			key: "FCC_HISTORY_STEP_EXCERPT_BYTES",
			value: "77",
		});
		await post("/api/settings/save", {
			key: "FCC_BUILD_MAX_STEPS",
			value: "10",
		});
		const reset = await post("/api/settings/reset", {
			key: "FCC_HISTORY_STEP_EXCERPT_BYTES",
		});
		assert.equal(reset.status, 200);
		assert.deepEqual(storedRows(), { FCC_BUILD_MAX_STEPS: "10" });
		const row = settingIn(reset, "FCC_HISTORY_STEP_EXCERPT_BYTES");
		assert.equal(row?.origin, "default");
		assert.equal(row?.effective, 300);
	});

	it("un valor inválido, una clave de arranque o una desconocida son 400 con el motivo y no escriben", async () => {
		env = await start();
		for (const [key, value, reason] of [
			[
				"FCC_HISTORY_STEP_EXCERPT_BYTES",
				"0",
				/^Tiene que ser un número entero mayor que 0\.$/,
			],
			["FCC_DB", "/tmp/otra.db", /FCC_DB/],
			["FCC_NO_EXISTE", "1", /FCC_NO_EXISTE/],
		] as const) {
			const r = await post("/api/settings/save", { key, value });
			assert.equal(r.status, 400, key);
			assert.equal(r.body.error?.type, "SettingRejected", key);
			assert.match(r.body.error?.message ?? "", reason);
		}
		const r = await post("/api/settings/reset", { key: "FCC_DB" });
		assert.equal(r.status, 400);
		assert.deepEqual(storedRows(), {});
	});

	it("una clave que fija el entorno del panel es 409 y no se guarda; restablecer borra lo guardado y el efectivo sigue siendo el del entorno", async () => {
		env = await start({ FCC_BUILD_MAX_STEPS: "30" });
		const r = await post("/api/settings/save", {
			key: "FCC_BUILD_MAX_STEPS",
			value: "10",
		});
		assert.equal(r.status, 409);
		assert.equal(r.body.error?.type, "SetByEnvironment");
		assert.deepEqual(storedRows(), {});
		// Un valor guardado de antes (D-6): restablecer lo borra
		env.exec(
			"INSERT INTO settings (key, value) VALUES ('FCC_BUILD_MAX_STEPS', '10')",
		);
		const reset = await post("/api/settings/reset", {
			key: "FCC_BUILD_MAX_STEPS",
		});
		assert.equal(reset.status, 200);
		assert.deepEqual(storedRows(), {});
		assert.equal(settingIn(reset, "FCC_BUILD_MAX_STEPS")?.effective, 30);
	});

	it("lo que no viene del panel no escribe: otro origen, otro Content-Type, parámetros en la URL, JSON roto o un campo de más", async () => {
		env = await start();
		const body = { key: "FCC_HISTORY_STEP_EXCERPT_BYTES", value: "77" };
		const cases: [string, Promise<Reply>, number][] = [
			[
				"otro origen",
				post("/api/settings/save", body, { Origin: "http://evil.test" }),
				403,
			],
			[
				"cross-site",
				post("/api/settings/save", body, { "Sec-Fetch-Site": "cross-site" }),
				403,
			],
			[
				"otro Content-Type",
				post("/api/settings/save", body, { "Content-Type": "text/plain" }),
				415,
			],
			[
				"parámetros en la URL",
				post("/api/settings/save?key=FCC_HISTORY_STEP_EXCERPT_BYTES", body),
				400,
			],
			["JSON roto", post("/api/settings/save", "{roto"), 400],
			[
				"un campo de más",
				post("/api/settings/save", { ...body, extra: true }),
				400,
			],
		];
		for (const [what, reply, status] of cases) {
			assert.equal((await reply).status, status, what);
		}
		const get = await fetch(`${env.dashboardUrl}/api/settings/save`);
		assert.equal(get.status, 405);
		assert.deepEqual(storedRows(), {});
	});
});
