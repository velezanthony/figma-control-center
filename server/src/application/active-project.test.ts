import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenantConfig } from "#domain/config.ts";
import { type ActiveProjectDeps, makeActiveProject } from "./active-project.ts";

const PANEL = "http://127.0.0.1:4173";

const tenant = (
	id: string,
	fileUrl = `https://www.figma.com/design/${id}/N`,
): TenantConfig => ({
	id,
	name: id,
	fileUrl,
	scriptsRoots: [],
	outputDir: `/out/${id}`,
	projectDir: "/proyecto",
	activityFile: `/out/${id}/activity.jsonl`,
});

function setup(initial: readonly TenantConfig[] = [], withStamp = false) {
	const state = {
		tenants: initial,
		problems: [] as string[],
		stamp: "1",
		resolves: 0,
	};
	const built: string[] = [];
	const disposed: string[] = [];
	const problemsSeen: (readonly string[])[] = [];
	let failBuild = false;
	const deps: ActiveProjectDeps<{ id: string }> = {
		resolve: async () => {
			state.resolves++;
			return { tenants: state.tenants, problems: state.problems };
		},
		...(withStamp && { stamp: () => state.stamp }),
		panelUrl: PANEL,
		build: async (t) => {
			if (failBuild) throw new Error("base ilegible");
			built.push(t.id);
			return { id: t.id };
		},
		dispose: (value) => {
			disposed.push(value.id);
		},
		onProblems: (p) => problemsSeen.push(p),
	};
	const active = makeActiveProject(deps);
	return {
		active,
		state,
		built,
		disposed,
		problemsSeen,
		failNextBuilds: (v: boolean) => {
			failBuild = v;
		},
	};
}

describe("makeActiveProject", () => {
	it("sin proyectos no monta nada y explica cómo darlo de alta", async () => {
		const { active, built } = setup();
		const r = await active.resolve();
		assert.ok(r.kind === "unavailable");
		assert.match(r.message, /No hay ningún proyecto/);
		assert.ok(r.message.includes(PANEL));
		assert.deepEqual(built, []);
		assert.equal(active.current(), null);
	});

	it("un proyecto dado de alta después se monta en la siguiente llamada, una sola vez", async () => {
		const { active, state, built } = setup();
		assert.ok((await active.resolve()).kind === "unavailable");
		state.tenants = [tenant("ejemplo")];
		const [a, b] = await Promise.all([active.resolve(), active.resolve()]);
		assert.ok(a.kind === "ready" && b.kind === "ready");
		assert.equal(a.value, b.value);
		await active.resolve();
		assert.deepEqual(built, ["ejemplo"]);
		assert.deepEqual(active.current(), { id: "ejemplo" });
	});

	it("si su configuración cambia, se vuelve a montar y se suelta el anterior", async () => {
		const { active, state, built, disposed } = setup([tenant("ejemplo")]);
		await active.resolve();
		state.tenants = [tenant("ejemplo", "https://www.figma.com/design/otro/N")];
		await active.resolve();
		assert.deepEqual(built, ["ejemplo", "ejemplo"]);
		assert.deepEqual(disposed, ["ejemplo"]);
	});

	it("si el proyecto desaparece, se suelta y las llamadas vuelven a dar el error", async () => {
		const { active, state, disposed } = setup([tenant("ejemplo")]);
		await active.resolve();
		state.tenants = [];
		const r = await active.resolve();
		assert.ok(r.kind === "unavailable");
		assert.deepEqual(disposed, ["ejemplo"]);
		assert.equal(active.current(), null);
	});

	it("con varios en alcance y ninguno elegido no sirve ninguno y lista los ids; el que servía se suelta", async () => {
		const { active, state, disposed } = setup([tenant("ejemplo")]);
		await active.resolve();
		state.tenants = [tenant("ejemplo"), tenant("cliente")];
		const r = await active.resolve();
		assert.ok(r.kind === "unavailable");
		assert.match(
			r.message,
			/elige uno: ejemplo \(«ejemplo»\), cliente \(«cliente»\)/,
		);
		assert.deepEqual(disposed, ["ejemplo"]);
	});

	it("un montaje fallido da un error de uso con el motivo y se reintenta en la siguiente llamada", async () => {
		const { active, built, failNextBuilds } = setup([tenant("ejemplo")]);
		failNextBuilds(true);
		const r = await active.resolve();
		assert.ok(r.kind === "unavailable");
		assert.match(r.message, /ejemplo/);
		assert.match(r.message, /base ilegible/);
		failNextBuilds(false);
		assert.ok((await active.resolve()).kind === "ready");
		assert.deepEqual(built, ["ejemplo"]);
	});

	it("los problemas del registro se cuentan una vez por cambio, no en cada llamada", async () => {
		const { active, state, problemsSeen } = setup();
		state.problems = ["registry.json: roto"];
		await active.resolve();
		await active.resolve();
		state.problems = [];
		await active.resolve();
		assert.deepEqual(problemsSeen, [["registry.json: roto"], []]);
	});

	it("close() suelta el proyecto montado", async () => {
		const { active, disposed } = setup([tenant("ejemplo")]);
		await active.resolve();
		active.close();
		assert.deepEqual(disposed, ["ejemplo"]);
		assert.equal(active.current(), null);
	});

	it("con un sello del registro que no cambia, una llamada con proyecto ya servido no vuelve a leer el registro; si cambia, sí", async () => {
		const { active, state } = setup([tenant("ejemplo")], true);
		await active.resolve();
		await active.resolve();
		await active.resolve();
		assert.equal(state.resolves, 1);
		state.tenants = [];
		state.stamp = "2";
		const r = await active.resolve();
		assert.ok(r.kind === "unavailable");
		assert.equal(state.resolves, 2);
	});

	it("sin proyecto servido, el sello no evita leer el registro", async () => {
		const { active, state } = setup([], true);
		await active.resolve();
		await active.resolve();
		assert.equal(state.resolves, 2);
	});
});

describe("makeActiveProject: sesión que no puede servir ningún proyecto", () => {
	it("con `refuse`, no consulta el registro ni monta nada y da ese error de uso", async () => {
		const state = { resolves: 0 };
		const built: string[] = [];
		const active = makeActiveProject<{ id: string }>({
			resolve: async () => {
				state.resolves++;
				return { tenants: [tenant("1")], problems: [] };
			},
			panelUrl: PANEL,
			build: async (t) => {
				built.push(t.id);
				return { id: t.id };
			},
			dispose: () => {},
			refuse: "Esta sesión de agente no tiene proyecto.",
		});
		assert.deepEqual(await active.resolve(), {
			kind: "unavailable",
			message: "Esta sesión de agente no tiene proyecto.",
		});
		assert.equal(active.current(), null);
		assert.deepEqual(built, []);
		assert.equal(state.resolves, 0);
	});
});
