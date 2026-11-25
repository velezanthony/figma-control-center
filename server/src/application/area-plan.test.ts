import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREAS_CONTRACT, type Area, type AreasFile } from "#domain/areas.ts";
import { kitPlanStep } from "#domain/build.ts";
import { areasContractError } from "#domain/figma-error.ts";
import { err } from "#domain/result.ts";
import { kitStepLabel } from "#domain/step.ts";
import { makeAreaPlan } from "./area-plan.ts";
import {
	InMemoryProjectConfig,
	InMemoryWebCaptureStore,
	projectWith,
} from "./testing/in-memory-web-capture.ts";

const area = (name: string, extra: Partial<Area> = {}): Area => ({
	name,
	page: name,
	frame: { width: 100, minHeight: 100 },
	place: {
		mode: "replace-content",
		source: { pagePrefix: "t ", take: "first-frame" },
	},
	screens: [{ frame: "a" }, { frame: "b" }],
	...extra,
});

const FILE: AreasFile = {
	contract: AREAS_CONTRACT,
	linkRules: {
		clickable: { names: [], namePrefixes: [], components: [] },
		rows: { row: ["fila"], body: ["cuerpo"] },
		transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
	},
	areas: [
		// completa: sale en un grupo compartido, tiene enlaces y rellenos
		area("Completa", {
			links: [{ from: "a", text: "Ir", to: "b" }],
			fills: [
				{ frame: "a", find: { text: "M", minSize: [1, 1] }, asset: "m.png" },
			],
		}),
		// solo punto de inicio
		area("Inicio", { flowStart: { frame: "a", name: "Inicio" } }),
		// mínima: ni compartido, ni enlaces, ni rellenos
		area("Minima"),
	],
	shared: [
		{
			name: "G",
			set: "G / Set",
			page: { name: "Compartido" },
			part: ["p"],
			variantProp: "area",
			from: [{ area: "Completa", frame: "a", value: "completa" }],
		},
	],
};

const plan = (
	names: readonly string[],
	project = projectWith([], {}, null, FILE),
) => makeAreaPlan({ project: new InMemoryProjectConfig(project) })(names);

const labels = (r: Awaited<ReturnType<typeof plan>>) => {
	assert.ok(r.kind === "plan", JSON.stringify(r));
	return r.plan.steps.map((s) => s.file);
};

describe("makeAreaPlan: el plan de un figma_build { areas }", () => {
	it("place → share → links → fill-image, cada uno con su etiqueta, su paso del kit y formato body", async () => {
		const r = await plan(["Completa"]);
		assert.deepEqual(labels(r), [
			kitStepLabel("kit/place@1", "Completa"),
			kitStepLabel("kit/share@1", "Completa"),
			kitStepLabel("kit/links@1", "Completa"),
			kitStepLabel("kit/fill-image@1", "Completa"),
		]);
		assert.ok(r.kind === "plan");
		assert.deepEqual(r.plan.steps[1]?.kit, {
			step: "kit/share@1",
			area: "Completa",
		});
		assert.equal(r.plan.steps[0]?.format, "body");
	});

	it("omite lo que el área no usa: sin compartido, sin enlaces ni inicio, sin rellenos", async () => {
		assert.deepEqual(labels(await plan(["Minima"])), [
			kitStepLabel("kit/place@1", "Minima"),
		]);
		assert.deepEqual(labels(await plan(["Inicio"])), [
			kitStepLabel("kit/place@1", "Inicio"),
			kitStepLabel("kit/links@1", "Inicio"),
		]);
	});

	it("con dos áreas, los pasos de cada una en el orden de la lista; el nombre del lote las nombra", async () => {
		const r = await plan(["Minima", "Inicio"]);
		assert.deepEqual(labels(r), [
			kitStepLabel("kit/place@1", "Minima"),
			kitStepLabel("kit/place@1", "Inicio"),
			kitStepLabel("kit/links@1", "Inicio"),
		]);
		assert.ok(r.kind === "plan");
		assert.equal(r.plan.name, "areas: Minima, Inicio");
	});

	it("un área desconocida es un error de uso con las que hay", async () => {
		const r = await plan(["Nada"]);
		assert.ok(r.kind === "usage");
		assert.match(r.message, /«Nada».*Completa, Inicio, Minima/);
	});

	it("un proyecto sin `areas` es ProjectConfigError con el campo `areas`", async () => {
		const r = await plan(["Completa"], projectWith([]));
		assert.ok(r.kind === "error");
		assert.equal(
			r.error.type === "ProjectConfigError" && r.error.field,
			"areas",
		);
	});

	it("un areas.json que no se puede leer devuelve su error tal cual", async () => {
		const project = new InMemoryProjectConfig(projectWith([]));
		project.reply = async () =>
			err(
				areasContractError("/p/areas.json", [
					{ pointer: "/areas", message: "x" },
				]),
			);
		const r = await makeAreaPlan({ project })(["Completa"]);
		assert.ok(r.kind === "error");
		assert.equal(r.error.type, "ContractError");
	});
});

describe("makeAreaPlan: kit/build-screen@1 delante de cada pantalla con captura", () => {
	const SCREENS = [
		{ key: "a", title: "A", url: "/a" },
		{ key: "b", title: "B", url: "/b" },
	];
	const FILE_WITH_SCREENS: AreasFile = {
		...FILE,
		areas: [
			area("Completa", {
				screens: [
					{ frame: "a", screen: "a" },
					{ frame: "b", screen: "b" },
					{ frame: "c" },
				],
			}),
			area("Minima"),
		],
		shared: [],
	};
	const MAPPED = {
		map: { contract: "map@1" } as never,
		mapSource: { path: "/p/map.json", sha256: "m", text: "{}" },
		iconCatalog: [],
	};
	const withProject = (mapped: boolean) =>
		projectWith(
			SCREENS,
			{},
			null,
			FILE_WITH_SCREENS,
			{},
			mapped ? MAPPED : undefined,
		);
	const run = async (
		names: readonly string[],
		captured: readonly string[],
		mapped = true,
	) => {
		const store = new InMemoryWebCaptureStore();
		for (const key of captured) await store.saveCapture(key, "{}");
		return makeAreaPlan({
			project: new InMemoryProjectConfig(withProject(mapped)),
			store,
		})(names);
	};

	it("antepone a `place` un build-screen por cada pantalla con captura; las que no, sin paso", async () => {
		const r = await run(["Completa"], ["a"]);
		assert.deepEqual(labels(r), [
			kitStepLabel("kit/build-screen@1", "a"),
			kitStepLabel("kit/place@1", "Completa"),
		]);
		assert.ok(r.kind === "plan");
		assert.deepEqual(r.plan.steps[0]?.kit, {
			step: "kit/build-screen@1",
			area: "Completa",
			screen: "a",
		});
		assert.equal(r.plan.steps[0]?.format, "body");
	});

	it("con captura de las dos, en el orden de las pantallas del área, y es el mismo plan que un manifiesto escrito a mano", async () => {
		const r = await run(["Completa"], ["b", "a"]);
		assert.ok(r.kind === "plan");
		assert.deepEqual(r.plan.steps.slice(0, 2), [
			kitPlanStep(
				{ use: "kit/build-screen@1", area: "Completa", screen: "a" },
				"body",
			),
			kitPlanStep(
				{ use: "kit/build-screen@1", area: "Completa", screen: "b" },
				"body",
			),
		]);
	});

	it("sin `map` en el proyecto no se pinta nada: el plan de F3 no cambia aunque haya capturas", async () => {
		assert.deepEqual(labels(await run(["Completa"], ["a", "b"], false)), [
			kitStepLabel("kit/place@1", "Completa"),
		]);
	});

	it("sin capturas, o en un área sin pantallas con `screen`, tampoco", async () => {
		assert.deepEqual(labels(await run(["Completa"], [])), [
			kitStepLabel("kit/place@1", "Completa"),
		]);
		assert.deepEqual(labels(await run(["Minima"], ["a"])), [
			kitStepLabel("kit/place@1", "Minima"),
		]);
	});
});
