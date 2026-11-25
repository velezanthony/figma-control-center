// kit.steps.fillImage: la imagen real como relleno del nodo que lleva un texto. Trampa 14.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { PANEL, paramsOf, png, warningCodes } from "../areas-support.ts";
import type { FakeFigma } from "../fake-figma.ts";
import { setup } from "../support.ts";

type Fill = {
	frame: string;
	nodeId: string;
	size: [number, number];
	hash: string;
};
const fillsOf = (r: { report?: unknown }) =>
	(r.report as { fills: Fill[] }).fills;

// Un frame con un mapa dentro: pequeños marcos anidados alrededor del texto «+» y el marco grande que lo contiene
function scene(fake: FakeFigma) {
	const page = fake.page("Panel");
	const frame = fake.node(page, "FRAME", "Detalle");
	const map = fake.node(frame, "FRAME", "mapa");
	map.resize(600, 400);
	const control = fake.node(map, "FRAME", "controles");
	control.resize(30, 60);
	const plus = fake.text(control, "t", "+");
	plus.resize(10, 10);
	return { page, frame, map };
}

const AREA = {
	...PANEL,
	screens: [{ frame: "Detalle" }],
	fills: [
		{
			frame: "Detalle",
			find: { text: "+", minSize: [300, 200] as [number, number] },
			asset: "mapa.png",
			name: "mapa real",
		},
	],
};
const assets = { "mapa.png": png(640, 480) };

describe("kit.steps.fillImage", () => {
	it("sube desde el texto hasta el primer antecesor del tamaño pedido y lo rellena con la imagen, recortado; cumple step@1", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		const result = await kit.steps.fillImage(paramsOf(AREA) as never, assets);
		assert.equal(StepResultSchema.safeParse(result).success, true);
		const fills = s.map.fills as {
			type: string;
			imageHash: string;
			scaleMode: string;
		}[];
		assert.equal(fills[0]?.type, "IMAGE");
		assert.equal(fills[0]?.scaleMode, "FILL");
		assert.equal(s.map.clipsContent, true);
		assert.equal(s.map.name, "mapa real");
		const [report] = fillsOf(result);
		assert.equal(report?.nodeId, s.map.id);
		assert.equal(report?.hash, fills[0]?.imageHash);
		assert.deepEqual(report?.size, [600, 400]);
		assert.deepEqual(
			result.mutatedNodeIds.sort(),
			[s.frame.id, s.map.id].sort(),
		);
	});

	it("si el nodo ya tiene la imagen con el mismo hash no lo toca", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		await kit.steps.fillImage(paramsOf(AREA) as never, assets);
		const again = await kit.steps.fillImage(paramsOf(AREA) as never, assets);
		assert.deepEqual(again.mutatedNodeIds, []);
		assert.equal(fillsOf(again).length, 1);
		assert.equal((s.map.fills as unknown[]).length, 1);
	});

	it("sin el texto o sin un antecesor tan grande avisa FILL_TARGET_NOT_FOUND y sigue", async () => {
		const { fake, kit } = setup();
		scene(fake);
		const area = {
			...AREA,
			fills: [
				{
					...(AREA.fills[0] as (typeof AREA.fills)[number]),
					find: { text: "no está", minSize: [300, 200] as [number, number] },
				},
				{
					...(AREA.fills[0] as (typeof AREA.fills)[number]),
					find: { text: "+", minSize: [5000, 5000] as [number, number] },
				},
			],
		};
		const result = await kit.steps.fillImage(paramsOf(area) as never, assets);
		assert.deepEqual(
			warningCodes(result).filter((c) => c !== "ADOPTED"),
			["FILL_TARGET_NOT_FOUND", "FILL_TARGET_NOT_FOUND"],
		);
		assert.deepEqual(fillsOf(result), []);
	});

	it("una imagen de más de 4096 px por lado o de otro formato falla IMAGE_UNSUPPORTED antes de crearla (trampa 14, sin verificar)", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		assert.throws(() => fake.createImage(png(4097, 10)), /too large/);
		await assert.rejects(
			kit.steps.fillImage(paramsOf(AREA) as never, {
				"mapa.png": png(4097, 10),
			}),
			(e: Error) =>
				e.message.includes("IMAGE_UNSUPPORTED") && e.message.includes("4097"),
		);
		await assert.rejects(
			kit.steps.fillImage(paramsOf(AREA) as never, {
				"mapa.png": new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]),
			}),
			(e: Error) => e.message.includes("IMAGE_UNSUPPORTED"),
		);
		assert.equal((s.map.fills as unknown[]).length, 0);
	});

	it("falla ASSET_MISSING si el paso no recibió los bytes de la imagen", async () => {
		const { fake, kit } = setup();
		scene(fake);
		await assert.rejects(
			kit.steps.fillImage(paramsOf(AREA) as never, {}),
			(e: Error) => e.message.includes("ASSET_MISSING"),
		);
	});

	it("falla AREA_NOT_FOUND si el frame no existe en Figma", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		s.frame.remove();
		await assert.rejects(
			kit.steps.fillImage(paramsOf(AREA) as never, assets),
			(e: Error) => e.message.includes("AREA_NOT_FOUND"),
		);
	});
});
