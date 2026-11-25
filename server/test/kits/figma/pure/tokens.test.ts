// kit.tokens, kit.paints, kit.icons, kit.json
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setup } from "../support.ts";

describe("kit.tokens.load", () => {
	it("lee las variables por nombre del único modo, con y sin el nombre de la colección", async () => {
		const { fake, kit } = setup();
		fake.collection("Color", 1, {
			"brand/500": "#f60",
			"text/primary": "#111",
		});
		const tokens = await kit.tokens.load();
		assert.equal(tokens.value("brand/500"), "#f60");
		assert.equal(tokens.value("Color/text/primary"), "#111");
		assert.equal(tokens.variable("brand/500")?.name, "brand/500");
		assert.equal(tokens.variable("nada"), undefined);
		assert.deepEqual(tokens.collections, ["Color"]);
	});

	it("un color sale como RGBA, igual que en Figma real, aunque se guardara como RGB", async () => {
		const { fake, kit } = setup();
		fake.collection("Color", 1, { rojo: { r: 1, g: 0, b: 0 } });
		const tokens = await kit.tokens.load();
		assert.deepEqual(tokens.value("rojo"), { r: 1, g: 0, b: 0, a: 1 });
	});

	it("una colección con varios modos AVISA y usa el de por defecto (no es un error)", async () => {
		const { fake, kit } = setup();
		fake.collection("Color", 2, { a: 1 });
		const t = kit.track();
		const tokens = await kit.tokens.load();
		assert.equal(tokens.value("a"), 1);
		assert.equal(t.done().warnings?.[0]?.code, "MULTI_MODE");
	});

	it("filtra por colecciones y falla con un nombre que no existe", async () => {
		const { fake, kit } = setup();
		fake.collection("Color", 1, { a: 1 });
		fake.collection("Espacio", 1, { b: 2 });
		assert.deepEqual(
			(await kit.tokens.load(["Espacio"]))
				.names()
				.filter((n) => !n.includes("/")),
			["b"],
		);
		await assert.rejects(kit.tokens.load(["Falta"]), /COLLECTION_NOT_FOUND/);
	});

	it("sigue los alias hasta el valor", async () => {
		const { fake, kit } = setup();
		const base = fake.collection("Base", 1, { rojo: "#f00" });
		const baseVar = fake.variableList.get(base.variableIds[0] ?? "");
		const sem = fake.collection("Semántica", 1, { peligro: null });
		const semVar = fake.variableList.get(sem.variableIds[0] ?? "");
		for (const m of sem.modes) {
			if (semVar && baseVar)
				semVar.valuesByMode[m.modeId] = {
					type: "VARIABLE_ALIAS",
					id: baseVar.id,
				};
		}
		assert.equal((await kit.tokens.load()).value("peligro"), "#f00");
	});
});

describe("kit.paints.set", () => {
	const color = { r: 1, g: 0, b: 0 };

	it("setBoundVariableForPaint pierde la opacidad; el kit la repone", async () => {
		const { fake, kit } = setup();
		fake.collection("Color", 1, { rojo: "#f00" });
		const variable = (await kit.tokens.load()).variable("rojo");
		const raw = fake.variables.setBoundVariableForPaint(
			{ type: "SOLID", color, opacity: 0.4 },
			"color",
			variable as never,
		);
		assert.equal(
			(raw as { opacity?: number }).opacity,
			undefined,
			"sin el kit se pierde",
		);

		const frame = fake.createFrame();
		kit.paints.set(frame as never, "fills", [
			{ bind: variable as never, opacity: 0.4 },
		]);
		const paint = frame.fills[0] as {
			opacity: number;
			boundVariables: { color: { id: string } };
		};
		assert.equal(paint.opacity, 0.4);
		assert.equal(paint.boundVariables.color.id, variable?.id);
	});

	it("sin opacidad dada, la pintura queda opaca; una pintura normal pasa tal cual", async () => {
		const { fake, kit } = setup();
		fake.collection("Color", 1, { rojo: "#f00" });
		const variable = (await kit.tokens.load()).variable("rojo");
		const frame = fake.createFrame();
		kit.paints.set(frame as never, "fills", [{ bind: variable as never }]);
		assert.equal((frame.fills[0] as { opacity: number }).opacity, 1);
		const plain = { type: "SOLID", color, opacity: 0.5 };
		kit.paints.set(frame as never, "strokes", [plain as never]);
		assert.deepEqual(frame.strokes, [plain]);
	});

	it("avisa al paso de que cambió el nodo", async () => {
		const { fake, kit } = setup();
		const frame = fake.createFrame();
		const t = kit.track();
		kit.paints.set(frame as never, "fills", []);
		assert.deepEqual(t.done().mutatedNodeIds, [frame.id]);
	});
});

describe("kit.icons.fromSvg", () => {
	it("vectorPaths con lineto implícito lanza; el kit usa createNodeFromSvg y nombra el icono", () => {
		const { fake, kit } = setup();
		const vector = fake.createVector();
		assert.throws(() => {
			vector.vectorPaths = [{ data: "M 0 0 10 10 Z" }];
		}, /implicit lineto/);
		const t = kit.track();
		const icon = kit.icons.fromSvg(
			"icons/fa-x",
			"<svg viewBox='0 0 1 1'></svg>",
			{ size: 16 },
		);
		assert.equal((icon as unknown as { name: string }).name, "icons/fa-x");
		assert.deepEqual(
			[
				(icon as unknown as { width: number }).width,
				(icon as unknown as { height: number }).height,
			],
			[16, 16],
		);
		assert.deepEqual(t.done().createdNodeIds, [
			(icon as unknown as { id: string }).id,
		]);
	});

	it("un SVG que Figma no lee da un error con siguiente paso", () => {
		const { kit } = setup();
		assert.throws(() => kit.icons.fromSvg("x", "no es svg"), /BAD_SVG/);
	});
});

describe("kit.json", () => {
	it("convierte los bytes de un asset en un objeto", () => {
		const { kit } = setup();
		assert.deepEqual(kit.json(new TextEncoder().encode('{"a":[1,2]}')), {
			a: [1, 2],
		});
	});

	it("bytes que no son JSON dan un error con siguiente paso", () => {
		const { kit } = setup();
		assert.throws(() => kit.json(new TextEncoder().encode("{")), /BAD_JSON/);
	});
});

describe("kit.tokens.load: entries (F4a)", () => {
	it("lista cada variable una sola vez, con su colección, en el orden de las colecciones", async () => {
		const { fake, kit } = setup();
		fake.collection("Base", 1, { a: 1, b: 2 });
		fake.collection("Sem", 1, { c: 3 });
		const tokens = await kit.tokens.load();
		assert.deepEqual(
			tokens.entries().map((e) => [e.collection, e.name, e.value]),
			[
				["Base", "a", 1],
				["Base", "b", 2],
				["Sem", "c", 3],
			],
		);
	});
});

describe("kit.paints.set: track (F4a)", () => {
	it("con `track: false` no apunta el nodo como cambiado: quien pinta cientos de nodos declara él lo suyo", () => {
		const { fake, kit } = setup();
		const t = kit.track();
		const a = fake.createFrame();
		const b = fake.createFrame();
		kit.paints.set(a as never, "fills", [
			{ type: "SOLID", color: { r: 0, g: 0, b: 0 } },
		]);
		kit.paints.set(
			b as never,
			"fills",
			[{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
			{ track: false },
		);
		assert.deepEqual(t.done().mutatedNodeIds, [a.id]);
	});
});
