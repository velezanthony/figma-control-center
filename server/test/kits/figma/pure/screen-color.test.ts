// kit.tokens.paint: color → variable. Trampas 1 y 2 (medidas).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planMap, world } from "../screen-support.ts";

type Map = { tokens: Record<string, unknown> };
const tokensCfg = () => (planMap() as unknown as Map).tokens as never;

async function resolver(
	w: ReturnType<typeof world>,
	cfg: Record<string, unknown> = {},
) {
	const tokens = await w.kit.tokens.load(["Base", "Semanticos"]);
	const warned: string[] = [];
	const r = w.kit.tokens.resolver(
		tokens,
		{ ...(tokensCfg() as object), ...cfg } as never,
		(c) => warned.push(c),
	);
	return { r, warned };
}

describe("kit.tokens.paint", () => {
	it("trampa 1 (medida): el valor de una variable sale en RGBA y se compara RGB aparte del alfa", async () => {
		const w = world();
		const { r } = await resolver(w);
		// la variable vale { r, g, b, a: 1 } en Figma; el color capturado lleva su propio alfa (0,5)
		const paint = r.paint([17, 24, 39, 0.5], ["text-text-primary"], "text") as {
			bind: { name: string };
			opacity: number;
		};
		assert.equal(paint.bind.name, "text/primary");
		assert.equal(paint.opacity, 0.5);
	});

	it("la clase del elemento manda: gana la variable de su clase si su valor es el color", async () => {
		const w = world();
		const { r } = await resolver(w);
		const paint = r.paint([255, 102, 0, 1], ["bg-brand-500"], "fill") as {
			bind: { name: string };
		};
		assert.equal(paint.bind.name, "brand/500");
	});

	it("una clase de variante (con «:») o con otro color no cuenta; entonces vale la de la colección de respaldo", async () => {
		const w = world();
		const { r, warned } = await resolver(w, {
			fallback: { collection: "Base" },
		});
		// «hover:bg-brand/500» se ignora y «bg-gray/900» es otro color: respaldo por color en Base
		const paint = r.paint(
			[255, 102, 0, 1],
			["hover:bg-brand-500 bg-gray-900"],
			"fill",
		) as { bind: { name: string } };
		assert.equal(paint.bind.name, "brand/500");
		assert.deepEqual(warned, []);
	});

	it("sin variable ni respaldo: el color suelto y se cuenta como sin variable", async () => {
		const w = world();
		const { r, warned } = await resolver(w);
		const paint = r.paint([1, 2, 3, 0.25], [""], "fill") as {
			type: string;
			color: { r: number };
			opacity: number;
		};
		assert.equal(paint.type, "SOLID");
		assert.equal(paint.color.r, 1 / 255);
		assert.equal(paint.opacity, 0.25);
		assert.deepEqual(warned, ["010203"]);
	});

	it("las reglas van en orden y la primera que da una variable que existe gana", async () => {
		const w = world();
		const { r } = await resolver(w, {
			classToVariable: [
				{ from: "^nada$", to: "no/existe" },
				{ from: "^gray-(\\d+)$", to: "gray/$1" },
			],
		});
		const paint = r.paint([250, 250, 250, 1], ["bg-gray-50"], "fill") as {
			bind: { name: string };
		};
		assert.equal(paint.bind.name, "gray/50");
	});

	it("el color de un svg prueba los prefijos de svg o, sin ellos, text + stroke + fill", async () => {
		const w = world();
		const base = tokensCfg() as { classPrefixes: Record<string, string[]> };
		const { r } = await resolver(w, {
			classPrefixes: { ...base.classPrefixes, stroke: ["stroke-"] },
		});
		const paint = r.paint([17, 24, 39, 1], ["stroke-gray-900"], "svg") as {
			bind: { name: string };
		};
		assert.equal(paint.bind.name, "gray/900");
		const { r: own } = await resolver(w, {
			classPrefixes: { ...base.classPrefixes, svg: ["solo-"] },
			fallback: undefined,
		});
		const plain = own.paint([17, 24, 39, 1], ["stroke-gray-900"], "svg") as {
			type?: string;
		};
		assert.equal(plain.type, "SOLID");
	});

	it("las variables numéricas se buscan por valor exacto (±0,01) y prefijo; el radio completo, por su nombre", async () => {
		const w = world();
		const { r } = await resolver(w);
		assert.equal(r.numVar("radius", 8)?.name, "radius/lg");
		assert.equal(r.numVar("radius", 8.005)?.name, "radius/lg");
		assert.equal(r.numVar("radius", 9), null);
		assert.equal(r.numVar("spacing", 16)?.name, "spacing/4");
		assert.equal(r.fullRadius()?.name, "radius/full");
	});

	it("trampa 2 (medida): un relleno ligado conserva su opacidad al pasar por kit.paints.set", async () => {
		const w = world();
		const { r } = await resolver(w);
		const rect = w.fake.createRectangle();
		const input = r.paint([17, 24, 39, 0.4], ["text-text-primary"], "text");
		w.kit.paints.set(rect as never, "fills", [input]);
		const fills = rect.fills as {
			opacity: number;
			boundVariables?: { color?: unknown };
		}[];
		assert.equal(fills[0]?.opacity, 0.4);
		assert.ok(fills[0]?.boundVariables?.color);
		// sin el kit: asignar la pintura recién ligada pierde la opacidad
		const bare = w.fake.createRectangle();
		const linked = w.fake.variables.setBoundVariableForPaint(
			{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.4 },
			"color",
			w.variable("gray/900"),
		);
		bare.fills = [{ ...linked, opacity: 0.4 }];
		assert.equal((bare.fills as { opacity: number }[])[0]?.opacity, 1);
	});
});
