import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenantConfig } from "#domain/config.ts";
import { type RegistryEntry, registryError } from "#domain/registry.ts";
import { err } from "#domain/result.ts";
import { resolveTenants } from "./resolve-tenants.ts";
import { InMemoryProjectRegistry } from "./testing/in-memory-project-registry.ts";

const tenant = (id: string): TenantConfig => ({
	id,
	name: id,
	fileUrl: `https://www.figma.com/design/${id}/N`,
	scriptsRoots: ["/scripts"],
	outputDir: `/out/${id}`,
	projectDir: "/proyecto",
	activityFile: `/out/${id}/activity.jsonl`,
});

// Resolver de prueba: una fila del registro → TenantConfig (la lógica real de rutas se prueba en schema.test.ts)
const resolveEntry = (e: RegistryEntry): TenantConfig => tenant(e.id);

const entry = (id: string): RegistryEntry => ({
	id,
	name: id,
	projectDir: `/p/${id}`,
	fileUrl: `https://www.figma.com/design/${id}/N`,
});

const ids = (ts: readonly TenantConfig[]) => ts.map((t) => t.id);

// Los proyectos salen solo del registro: el .env no crea ninguno (D-1)
describe("resolveTenants", () => {
	it("registro vacío: ningún proyecto", async () => {
		const res = await resolveTenants({
			registry: new InMemoryProjectRegistry(),
			scope: { kind: "any" },
			resolveEntry,
		});
		assert.deepEqual(res.tenants, []);
	});

	it("alcance any: todos los del registro, en su orden", async () => {
		const registry = new InMemoryProjectRegistry({
			entries: [entry("ejemplo"), entry("cliente")],
		});
		const res = await resolveTenants({
			registry,
			scope: { kind: "any" },
			resolveEntry,
		});
		assert.deepEqual(ids(res.tenants), ["ejemplo", "cliente"]);
	});

	it("alcance por ids: solo los permitidos", async () => {
		const registry = new InMemoryProjectRegistry({
			entries: [entry("ejemplo"), entry("cliente")],
		});
		const res = await resolveTenants({
			registry,
			scope: { kind: "ids", ids: ["ejemplo"] },
			resolveEntry,
		});
		assert.deepEqual(ids(res.tenants), ["ejemplo"]);
	});

	it("si el registro no se puede leer, no hay proyectos y lo avisa", async () => {
		const registry = new InMemoryProjectRegistry();
		registry.readReply = () =>
			err(registryError("malformed", "roto en /x/registry.json"));
		const res = await resolveTenants({
			registry,
			scope: { kind: "any" },
			resolveEntry,
		});
		assert.deepEqual(res.tenants, []);
		assert.deepEqual(res.problems, ["roto en /x/registry.json"]);
	});

	it("los avisos de filas ignoradas del registro llegan a quien lo pidió", async () => {
		const registry = new InMemoryProjectRegistry({
			entries: [entry("ejemplo")],
			problems: ["fila 2: id inválido"],
		});
		const res = await resolveTenants({
			registry,
			scope: { kind: "any" },
			resolveEntry,
		});
		assert.deepEqual(ids(res.tenants), ["ejemplo"]);
		assert.deepEqual(res.problems, ["fila 2: id inválido"]);
	});

	it("un alcance que deja la lista vacía no da acceso a nada, aunque el registro falle", async () => {
		const registry = new InMemoryProjectRegistry();
		registry.readReply = () => err(registryError("malformed", "roto"));
		const res = await resolveTenants({
			registry,
			scope: { kind: "ids", ids: ["ejemplo"] },
			resolveEntry,
		});
		assert.deepEqual(ids(res.tenants), []);
	});
});
