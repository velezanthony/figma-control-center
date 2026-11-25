// track() y fail(): el seguimiento del paso y los errores con siguiente paso
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { createTracker } from "../../../../../kits/figma/core.ts";
import { setup } from "../support.ts";

describe("kit.track()", () => {
	it("lleva la cuenta de creados, cambiados y borrados sin repetir ids", () => {
		const t = createTracker();
		t.created("1:1");
		t.created({ id: "1:2" });
		t.created(["1:3", "1:3"]);
		t.mutated("1:4");
		t.mutated("1:4");
		t.removed("1:5");
		assert.deepEqual(t.done(), {
			createdNodeIds: ["1:1", "1:2", "1:3"],
			mutatedNodeIds: ["1:4"],
			removedNodeIds: ["1:5"],
		});
	});

	it("un nodo creado y luego cambiado cuenta solo como creado; uno creado y luego borrado, solo como borrado", () => {
		const t = createTracker();
		t.created(["1:1", "1:2"]);
		t.mutated("1:1");
		t.removed("1:2");
		assert.deepEqual(t.done(), {
			createdNodeIds: ["1:1"],
			mutatedNodeIds: [],
			removedNodeIds: ["1:2"],
		});
	});

	it("los avisos y el informe salen en done(); sin ellos no hay claves vacías", () => {
		const t = createTracker();
		t.warn("A", "uno", "1:1");
		t.warn("B", "dos");
		assert.deepEqual(t.done({ n: 2 }), {
			createdNodeIds: [],
			mutatedNodeIds: [],
			warnings: [
				{ code: "A", message: "uno", nodeId: "1:1" },
				{ code: "B", message: "dos" },
			],
			report: { n: 2 },
		});
		assert.deepEqual(createTracker().done(), {
			createdNodeIds: [],
			mutatedNodeIds: [],
		});
	});

	it("lo que devuelve done() cumple el zod de step@1 (el kit repite sus tipos)", () => {
		const t = createTracker();
		t.created("1:1");
		t.mutated("1:2");
		t.removed("1:3");
		t.warn("A", "uno", "1:1");
		assert.equal(StepResultSchema.safeParse(t.done({ x: [1] })).success, true);
		assert.equal(
			StepResultSchema.safeParse(createTracker().done()).success,
			true,
		);
	});

	it("las piezas que crean avisan al track() del paso en curso", async () => {
		const { fake, kit } = setup();
		const t = kit.track();
		const page = await kit.page.ensure({ key: "k", name: "Pruebas" });
		assert.deepEqual(t.done().createdNodeIds, [page.id]);
		assert.equal(fake.root.children.includes(page as never), true);
	});

	it("un track() nuevo empieza de cero", async () => {
		const { kit } = setup();
		kit.track();
		await kit.page.ensure({ key: "k", name: "Pruebas" });
		assert.deepEqual(kit.track().done().createdNodeIds, []);
	});

	it("sin track() las piezas funcionan igual", async () => {
		const { kit } = setup();
		const page = await kit.page.ensure({ key: "k", name: "Pruebas" });
		assert.equal(page.name, "Pruebas");
	});
});

describe("kit.fail()", () => {
	it("lanza un error con el código, el mensaje y el siguiente paso tras la marca", () => {
		const { kit } = setup();
		assert.throws(
			() => kit.fail("SIN_SET", "No hay set", "Mira figma_components"),
			(e: Error) => {
				const json = e.message.slice(e.message.indexOf("{"));
				assert.deepEqual(JSON.parse(json), {
					code: "SIN_SET",
					message: "No hay set",
					next: "Mira figma_components",
				});
				return e.message.startsWith("__fcc_kit_fail__:");
			},
		);
	});
});
