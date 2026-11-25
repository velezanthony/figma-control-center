import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenantConfig } from "#domain/config.ts";
import { makePanelTenants } from "./panel-tenants.ts";

const config = (id: string, outputDir = `/out/${id}`): TenantConfig => ({
	id,
	name: id,
	fileUrl: `https://www.figma.com/design/${id}/x`,
	scriptsRoots: ["/s"],
	outputDir,
	projectDir: "/proyecto",
	activityFile: `/out/${id}/activity.jsonl`,
});

function setup(initial: TenantConfig[]) {
	let current = initial;
	const built: string[] = [];
	const disposed: string[] = [];
	const forProject = makePanelTenants<{ id: string; outputDir: string }>({
		resolve: async () => current,
		build: async (c) => {
			built.push(c.id);
			return { id: c.id, outputDir: c.outputDir };
		},
		dispose: (t) => disposed.push(t.id),
	});
	return {
		forProject,
		built,
		disposed,
		setRegistry: (next: TenantConfig[]) => {
			current = next;
		},
	};
}

describe("makePanelTenants", () => {
	it("sin id sirve el primero", async () => {
		const { forProject } = setup([config("default")]);
		assert.equal((await forProject(null))?.id, "default");
	});

	it("un proyecto dado de alta después de arrancar se sirve sin reiniciar", async () => {
		const { forProject, setRegistry } = setup([config("default")]);
		assert.equal(await forProject("nuevo"), undefined);
		setRegistry([config("default"), config("nuevo")]);
		assert.equal((await forProject("nuevo"))?.id, "nuevo");
	});

	it("un proyecto se monta una vez aunque se pida varias veces a la vez", async () => {
		const { forProject, built } = setup([config("default"), config("a")]);
		await Promise.all([forProject("a"), forProject("a"), forProject("a")]);
		await forProject("a");
		assert.deepEqual(built, ["a"]);
	});

	it("un proyecto borrado deja de servirse y se libera", async () => {
		const { forProject, setRegistry, disposed } = setup([
			config("default"),
			config("a"),
		]);
		assert.equal((await forProject("a"))?.id, "a");
		setRegistry([config("default")]);
		assert.equal(await forProject("a"), undefined);
		assert.deepEqual(disposed, ["a"]);
	});

	it("un proyecto cuya configuración cambia se vuelve a montar y el viejo se libera", async () => {
		const { forProject, setRegistry, built, disposed } = setup([
			config("default"),
			config("a"),
		]);
		await forProject("a");
		setRegistry([config("default"), config("a", "/out/otra")]);
		assert.equal((await forProject("a"))?.outputDir, "/out/otra");
		assert.deepEqual(built, ["a", "a"]);
		assert.deepEqual(disposed, ["a"]);
	});

	it("un id que no existe en el registro no monta nada", async () => {
		const { forProject, built } = setup([config("default")]);
		assert.equal(await forProject("fantasma"), undefined);
		assert.deepEqual(built, []);
	});

	it("una petición sin id sirve el primero del registro", async () => {
		const built: string[] = [];
		const forProject = makePanelTenants<string>({
			resolve: async () => [config("ejemplo"), config("cliente")],
			build: async (c) => {
				built.push(c.id);
				return c.id;
			},
			dispose: () => {},
		});
		assert.equal(await forProject(null), "ejemplo");
		assert.equal(await forProject("cliente"), "cliente");
		assert.equal(await forProject("nada"), undefined);
	});

	it("sin proyectos no hay a quién servir", async () => {
		const forProject = makePanelTenants<string>({
			resolve: async () => [],
			build: async (c) => c.id,
			dispose: () => {},
		});
		assert.equal(await forProject(null), undefined);
	});
});
