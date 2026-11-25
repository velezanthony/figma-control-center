// kit.flow.start (trampa 12)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { setup } from "../support.ts";

describe("kit.flow.start", () => {
	it("asignar la lista entera borra los otros puntos de inicio (trampa 12, medida): el kit conserva los que no son suyos", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const a = fake.node(page, "FRAME", "A");
		const b = fake.node(page, "FRAME", "B");
		page.flowStartingPoints = [{ nodeId: b.id, name: "Móvil" }];
		// a mano, sin leer los que hay: se pierde el otro
		page.flowStartingPoints = [{ nodeId: a.id, name: "Escritorio" }];
		assert.deepEqual(
			page.flowStartingPoints.map((p) => p.name),
			["Escritorio"],
		);
		page.flowStartingPoints = [{ nodeId: b.id, name: "Móvil" }];
		const r = kit.flow.start(page as never, a as never, "Escritorio");
		assert.deepEqual(r, { changed: true });
		assert.deepEqual(page.flowStartingPoints, [
			{ nodeId: b.id, name: "Móvil" },
			{ nodeId: a.id, name: "Escritorio" },
		]);
	});

	it("si ya existe un punto con ese nombre lo apunta al frame nuevo; si ya apunta a él, no cambia nada", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const a = fake.node(page, "FRAME", "A");
		const b = fake.node(page, "FRAME", "B");
		page.flowStartingPoints = [{ nodeId: a.id, name: "Inicio" }];
		assert.deepEqual(kit.flow.start(page as never, b as never, "Inicio"), {
			changed: true,
		});
		assert.deepEqual(page.flowStartingPoints, [
			{ nodeId: b.id, name: "Inicio" },
		]);
		const t = kit.track();
		assert.deepEqual(kit.flow.start(page as never, b as never, "Inicio"), {
			changed: false,
		});
		assert.deepEqual(t.done().mutatedNodeIds, []);
	});

	it("declara la página como cambiada cuando asigna; cumple step@1", () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const a = fake.node(page, "FRAME", "A");
		const t = kit.track();
		kit.flow.start(page as never, a as never, "Inicio");
		const done = t.done();
		assert.deepEqual(done.mutatedNodeIds, [page.id]);
		assert.equal(StepResultSchema.safeParse(done).success, true);
	});

	it("Figma lanza con dos puntos del mismo frame (medido): el punto con otro nombre sobre el mismo frame se sustituye", () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const a = fake.node(page, "FRAME", "A");
		page.flowStartingPoints = [{ nodeId: a.id, name: "Viejo" }];
		assert.throws(() => {
			page.flowStartingPoints = [
				{ nodeId: a.id, name: "Viejo" },
				{ nodeId: a.id, name: "Nuevo" },
			];
		}, /duplicate input nodeIds/);
		assert.deepEqual(kit.flow.start(page as never, a as never, "Nuevo"), {
			changed: true,
		});
		assert.deepEqual(page.flowStartingPoints, [
			{ nodeId: a.id, name: "Nuevo" },
		]);
	});
});
