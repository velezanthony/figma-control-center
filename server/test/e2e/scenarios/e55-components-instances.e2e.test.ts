// E55 componentes e instancias: el catálogo de componentes con variantes y propiedades, y el conteo de
// instancias por frame con el nombre del set. Servidor MCP real, con el simulador de Figma.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	ComponentsValueSchema,
	InstancesValueSchema,
} from "../../contracts/figma-values.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";

let env: Environment;
let claude: FakeClaudeCode;
before(async () => {
	env = await startEnvironment();
	claude = await env.startClaude({ reply: null });
});
after(async () => {
	await env?.stop();
});

const fileOf = async (out: Record<string, unknown>) =>
	JSON.parse(await readFile(String(out["path"]), "utf8")) as unknown;

describe("E55 · componentes e instancias", () => {
	it("figma_components lista el set con sus opciones de variante y propiedades, y el componente suelto", async () => {
		const r = await claude.callTool(TOOL_NAME.components, {});
		assert.equal(r.out["ok"], true);
		const { components } = ComponentsValueSchema.parse(await fileOf(r.out));
		const set = components.find((c) => c.type === "COMPONENT_SET");
		assert.equal(set?.name, "Botón");
		assert.deepEqual(set?.variants, {
			Tamaño: ["S", "M"],
			Tipo: ["Primario", "Secundario"],
		});
		assert.deepEqual(set?.properties, [
			{ name: "Texto#1:0", type: "TEXT", defaultValue: "Aceptar" },
		]);
		assert.equal(set?.page, "Componentes");
		assert.deepEqual(r.out["summary"], { sets: 1, components: 1, pages: 1 });
	});

	it("`query` filtra por el nombre y una página que no existe es un error con su nombre", async () => {
		const byName = await claude.callTool(TOOL_NAME.components, {
			query: "icono",
		});
		assert.deepEqual(byName.out["summary"], {
			sets: 0,
			components: 1,
			pages: 1,
		});
		const missing = await claude.callTool(TOOL_NAME.components, {
			page: "No existe",
		});
		assert.equal(missing.isError, true);
		assert.equal(missing.out["ok"], false);
		const error = missing.out["error"] as { type: string; message: string };
		assert.equal(error.type, "ScriptError");
		assert.match(error.message, /No existe/);
	});

	it("figma_instances cuenta por frame de primer nivel con el nombre del set", async () => {
		const r = await claude.callTool(TOOL_NAME.instances, { pages: ["Inicio"] });
		assert.equal(r.out["ok"], true);
		const { frames } = InstancesValueSchema.parse(await fileOf(r.out));
		assert.deepEqual(frames, [
			{
				page: "Inicio",
				frameId: "10:1",
				frameName: "Tarjeta",
				counts: { Botón: 2, Icono: 1 },
			},
		]);
		assert.deepEqual(r.out["summary"], { frames: 1, instances: 3 });
	});
});
