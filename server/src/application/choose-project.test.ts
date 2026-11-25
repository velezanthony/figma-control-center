import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenantConfig } from "#domain/config.ts";
import { chooseProject } from "./choose-project.ts";

const tenant = (id: string, name = id): TenantConfig => ({
	id,
	name,
	fileUrl: `https://www.figma.com/design/${id}/N`,
	scriptsRoots: [],
	outputDir: `/out/${id}`,
	projectDir: "/proyecto",
	activityFile: `/out/${id}/activity.jsonl`,
});

const PANEL = "http://127.0.0.1:4173";

describe("chooseProject", () => {
	it("con un solo proyecto en alcance, ese", () => {
		const choice = chooseProject([tenant("ejemplo")], PANEL);
		assert.ok(choice.kind === "one");
		assert.equal(choice.tenant.id, "ejemplo");
	});

	it("sin proyectos no hay ninguno y el mensaje manda a darlo de alta en Proyectos con la URL del panel, no al .env", () => {
		const choice = chooseProject([], PANEL);
		assert.ok(choice.kind === "none");
		assert.match(choice.message, /^No hay ningún proyecto\./);
		assert.match(choice.message, /"Proyectos"/);
		assert.ok(choice.message.includes(PANEL));
		assert.doesNotMatch(choice.message, /FIGMA_FILE_URL|\.env/);
	});

	it("con el registro ilegible el mensaje añade el problema", () => {
		const choice = chooseProject([], PANEL, ["registry.json: JSON roto"]);
		assert.ok(choice.kind === "none");
		assert.match(choice.message, /registry\.json: JSON roto/);
	});

	it("con varios y ninguno elegido es ambiguo: el mensaje lista los ids y cómo elegir", () => {
		const choice = chooseProject([tenant("ejemplo"), tenant("cliente")], PANEL);
		assert.ok(choice.kind === "ambiguous");
		assert.match(choice.message, /ejemplo/);
		assert.match(choice.message, /cliente/);
		assert.match(choice.message, /FCC_PROJECTS/);
		assert.match(
			choice.message,
			/elige uno: ejemplo \(«ejemplo»\), cliente \(«cliente»\)/,
		);
		assert.match(choice.message, /make agent PROJECT=/);
	});

	it("los ids son números que no dicen nada: el mensaje los acompaña del nombre del proyecto", () => {
		const choice = chooseProject(
			[tenant("1", "Ejemplo"), tenant("2", "Cliente")],
			PANEL,
		);
		assert.ok(choice.kind === "ambiguous");
		assert.match(choice.message, /elige uno: 1 \(«Ejemplo»\), 2 \(«Cliente»\)/);
		assert.deepEqual(choice.ids, ["1", "2"]);
	});
});
