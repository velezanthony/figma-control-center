import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wrapScript } from "#adapters/cdp/script-wrapper.ts";
import { stepResultIssues } from "#adapters/contracts/step.ts";
import { SCRIPT_FORMAT } from "#application/ports/figma-gateway.ts";
import { kitStepCode } from "#domain/step.ts";
import { kitStepReply } from "./kit-step-reply.ts";

const AREA = {
	name: "Panel",
	page: "Panel",
	frame: { width: 100, minHeight: 100 },
	place: {
		mode: "replace-content",
		source: { pagePrefix: "t ", take: "first-frame" },
	},
	shell: { set: "S", in: ["l"], variantProp: "activa", default: "inicio" },
	screens: [{ frame: "Inicio", shell: "inicio" }, { frame: "Detalle" }],
	links: [
		{ from: "Inicio", text: "Ir", to: "Detalle" },
		{ from: "Inicio", text: "Botón que no existe", to: "Detalle" },
		{ from: "Inicio", rows: true, to: "Detalle" },
	],
	fills: [
		{ frame: "Detalle", find: { text: "+", minSize: [1, 1] }, asset: "m.png" },
	],
};
const SHARED = {
	name: "G",
	set: "G / S",
	page: { name: "C" },
	part: ["p"],
	variantProp: "area",
	from: [{ area: "Panel", frame: "Inicio", value: "panel" }],
};
const params = { area: AREA, linkRules: {}, shared: [SHARED] };

const expressionOf = (
	step: Parameters<typeof kitStepCode>[0],
	assets: Record<string, Uint8Array> = {},
) =>
	wrapScript({
		code: kitStepCode(step),
		format: SCRIPT_FORMAT.body,
		params,
		assets,
	}).expression;

const reply = (
	step: Parameters<typeof kitStepCode>[0],
	assets?: Record<string, Uint8Array>,
) => {
	const r = kitStepReply(expressionOf(step, assets));
	assert.ok(r !== null && r.kind === "value");
	return r.value as {
		mutatedNodeIds: string[];
		warnings?: { code: string; message: string }[];
		report: Record<string, unknown[]>;
	};
};

describe("kitStepReply: el simulador contesta un paso del kit desde sus params", () => {
	it("no reconoce lo que no es un paso del kit", () => {
		assert.equal(kitStepReply("(async () => { return 1; })()"), null);
		assert.equal(
			kitStepReply(
				"(async () => {const params = {};const assets = {};const kit = x;\nreturn 1;\n})()",
			),
			null,
		);
	});

	it("todos los pasos devuelven un resultado que cumple step@1", () => {
		for (const step of [
			"kit/place@1",
			"kit/share@1",
			"kit/links@1",
			"kit/fill-image@1",
			"kit/layout-check@1",
		] as const) {
			const r = kitStepReply(expressionOf(step));
			assert.ok(r !== null && r.kind === "value");
			assert.deepEqual(stepResultIssues(r.value), [], step);
		}
	});

	it("place: un frame por pantalla con su variante del shell", () => {
		const out = reply("kit/place@1");
		assert.deepEqual(
			(out.report["frames"] as { frame: string; shell?: string }[]).map((f) => [
				f.frame,
				f.shell,
			]),
			[
				["Inicio", "inicio"],
				["Detalle", "inicio"],
			],
		);
		assert.equal(out.mutatedNodeIds.length, 2);
	});

	it("share: una entrada por cada `from` del área", () => {
		const out = reply("kit/share@1");
		assert.deepEqual(out.report["shared"], [
			{ group: "G", area: "Panel", frame: "Inicio", variant: "area=panel" },
		]);
	});

	it("links: cuenta 1 por enlace de texto (0 si dice «no existe», con su aviso LINK_ZERO) y 2 por filas", () => {
		const out = reply("kit/links@1");
		assert.deepEqual(
			(out.report["links"] as { count: number }[]).map((l) => l.count),
			[1, 0, 2],
		);
		assert.equal(out.warnings?.[0]?.code, "LINK_ZERO");
		assert.match(out.warnings?.[0]?.message ?? "", /Botón que no existe/);
	});

	it("layout-check: un frame por pantalla del área, con ceros, sin tocar nada", () => {
		const out = reply("kit/layout-check@1");
		assert.deepEqual(
			(out.report["layout"] as { frame: string; overlaps: number }[]).map(
				(l) => [l.frame, l.overlaps],
			),
			[
				["Inicio", 0],
				["Detalle", 0],
			],
		);
		assert.deepEqual(out.mutatedNodeIds, []);
	});

	it("fill-image: un relleno por cada `fills`", () => {
		const out = reply("kit/fill-image@1", { "m.png": Uint8Array.from([1]) });
		assert.equal(out.report["fills"]?.length, 1);
	});
});

describe("kitStepReply: kit/build-screen@1", () => {
	const plan = {
		contract: "screen@1",
		screen: "inicio",
		target: { page: { name: "tmp Inicio" }, frame: { name: "Inicio" } },
		root: [
			{
				t: "frame",
				kids: [{ t: "text" }, { t: "frame", kids: [{ t: "svg" }] }],
			},
		],
		images: { [`${"a".repeat(64)}`]: {} },
	};
	const expression = () =>
		wrapScript({
			code: kitStepCode("kit/build-screen@1"),
			format: SCRIPT_FORMAT.body,
			params: { screen: "inicio", area: "Panel", frame: "Inicio", variant: 0 },
			assets: { plan: new TextEncoder().encode(JSON.stringify(plan)) },
		}).expression;

	it("contesta desde el plan que lleva como asset: cuenta sus nodos y sus imágenes, y cumple step@1", () => {
		const r = kitStepReply(expression());
		assert.ok(r !== null && r.kind === "value");
		assert.deepEqual(stepResultIssues(r.value), []);
		const value = r.value as {
			createdNodeIds: string[];
			report: Record<string, unknown>;
		};
		assert.equal(value.createdNodeIds.length, 2);
		assert.equal(value.report["screen"], "inicio");
		assert.equal(value.report["page"], "tmp Inicio");
		assert.equal(value.report["nodes"], 4);
		assert.equal(value.report["images"], 1);
		assert.deepEqual(value.report["matches"], []);
	});

	it("con recognize@1 en el código y reglas o huellas en el plan, informa de una coincidencia simulada por cada una (no reconoce nada de verdad)", () => {
		const recognizing = {
			...plan,
			root: [{ id: "00000001", t: "frame", kids: [] }],
			rules: ["Boton"],
			fingerprints: { "a.b": { title: "Marca" } },
		};
		const r = kitStepReply(
			wrapScript({
				code: kitStepCode("kit/build-screen@1", {
					recognize: '{ contract: "recognize@1", rules: {} }',
				}),
				format: SCRIPT_FORMAT.body,
				params: { screen: "inicio", variant: 0 },
				assets: {
					plan: new TextEncoder().encode(JSON.stringify(recognizing)),
				},
			}).expression,
		);
		assert.ok(r !== null && r.kind === "value");
		assert.deepEqual(stepResultIssues(r.value), []);
		const report = (
			r.value as {
				report: {
					matches: { node: string; set: string; by: string }[];
					instances: Record<string, number>;
				};
			}
		).report;
		assert.deepEqual(report.matches, [
			{ node: "00000001", set: "Boton", by: "rule:Boton" },
			{ node: "00000001", set: "Marca", by: "fingerprint" },
		]);
		assert.deepEqual(report.instances, { Boton: 1, Marca: 1 });
	});

	it("sin el asset `plan`, no inventa nada: no contesta", () => {
		const bare = wrapScript({
			code: kitStepCode("kit/build-screen@1"),
			format: SCRIPT_FORMAT.body,
			params: { screen: "inicio", variant: 0 },
			assets: {},
		}).expression;
		assert.equal(kitStepReply(bare), null);
	});
});

describe("el simulador y kit/build-component@1", () => {
	const plan = {
		contract: "component@1",
		sheet: { key: "button", title: "Button" },
		target: { page: { name: "fcc · hoja · button" }, set: { name: "Button" } },
		variants: [
			{ props: { size: "sm" }, root: [{ id: "a", kids: [{ id: "b" }] }] },
			{ props: { size: "lg" }, root: [{ id: "c" }] },
		],
		images: {},
		fingerprints: { x: { title: "Badge" } },
		rules: ["Avatar"],
	};
	const code = (recognize: string | null = null) =>
		wrapScript({
			code: kitStepCode("kit/build-component@1", { recognize }),
			format: SCRIPT_FORMAT.body,
			params: { sheet: "button", scratch: true },
			assets: { plan: new TextEncoder().encode(JSON.stringify(plan)) },
		}).expression;

	it("lo reconoce por su cabecera y contesta un StepResult hecho desde el plan, sin pintar", () => {
		const r = kitStepReply(code());
		assert.ok(r !== null && r.kind === "value");
		const v = r.value as {
			report: Record<string, unknown>;
			createdNodeIds: string[];
		};
		assert.deepEqual(stepResultIssues(v), []);
		assert.equal(v.report["sheet"], "button");
		assert.equal(v.report["page"], "fcc · hoja · button");
		assert.deepEqual(v.report["variants"], { created: 2, updated: 0, kept: 0 });
		assert.equal((v.report["matches"] as unknown[]).length, 2);
	});

	it("con un módulo recognize@1 en el código también lo reconoce", () => {
		const r = kitStepReply(code('{ contract: "recognize@1", rules: {} }'));
		assert.ok(r !== null && r.kind === "value");
	});
});

describe("el simulador y kit/compose@1", () => {
	const compose = (key: string) => ({
		contract: "compose@1",
		key,
		title: "Ficha",
		target: { page: "Pruebas", width: 480 },
		root: {
			stack: "VERTICAL",
			children: [
				{ text: "Hola", style: "Título/L" },
				{ use: "marca", slots: { pie: [{ text: "x", style: "Título/L" }] } },
				{ stack: "HORIZONTAL", children: [{ use: "marca" }] },
			],
		},
	});
	const code = (key: string) =>
		wrapScript({
			code: kitStepCode("kit/compose@1"),
			format: SCRIPT_FORMAT.body,
			params: {
				compose: compose(key),
				sheets: [{ key: "marca", title: "Marca" }],
			},
			assets: {},
		}).expression;
	const value = (key: string) => {
		const r = kitStepReply(code(key));
		assert.ok(r !== null && r.kind === "value");
		return r.value as {
			createdNodeIds: string[];
			mutatedNodeIds: string[];
			removedNodeIds?: string[];
			report: Record<string, unknown>;
		};
	};

	it("lo reconoce por su cabecera y contesta un StepResult hecho desde el compose, sin pintar", () => {
		const v = value("sim-a");
		assert.deepEqual(stepResultIssues(v), []);
		assert.equal(v.report["compose"], "sim-a");
		assert.equal(v.report["page"], "Pruebas");
		assert.equal(v.report["rebuilt"], false);
		assert.equal(v.report["frames"], 1);
		assert.equal(v.report["texts"], 2);
		assert.deepEqual(v.report["instances"], { marca: 2 });
		assert.equal(v.report["slots"], 1);
		assert.ok(v.createdNodeIds.includes(String(v.report["frameId"])));
	});

	it("la segunda vez rehace el frame (mismo id, contenido nuevo) en vez de crear otro", () => {
		const first = value("sim-b");
		const second = value("sim-b");
		assert.equal(second.report["rebuilt"], true);
		assert.equal(second.report["frameId"], first.report["frameId"]);
		assert.equal(
			second.createdNodeIds.includes(String(first.report["frameId"])),
			false,
		);
		assert.deepEqual(second.mutatedNodeIds, [String(first.report["frameId"])]);
		assert.ok((second.removedNodeIds ?? []).length > 0);
		assert.deepEqual(stepResultIssues(second), []);
	});
});
