import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Screen } from "#domain/capture.ts";
import {
	SHEETS_CONTRACT,
	type Sheet,
	type SheetsFile,
} from "#domain/sheets.ts";
import { kitStepLabel } from "#domain/step.ts";
import { makeSheetsPlan } from "./sheets-plan.ts";
import {
	InMemoryProjectConfig,
	InMemoryWebCaptureStore,
	projectWith,
} from "./testing/in-memory-web-capture.ts";

const sheet = (key: string, screen: string): Sheet => ({
	key,
	screen,
	title: key,
	page: { name: `   ${key}` },
	description: "d",
});
const SHEETS: SheetsFile = {
	contract: SHEETS_CONTRACT,
	style: {
		header: { fill: "a", text: "b" },
		card: { fill: "c" },
		texts: {
			description: "d",
			bug: "e",
			tag: "f",
			rowLabel: "g",
			colLabel: "h",
		},
		matrix: { stroke: "i" },
	},
	sheets: [
		sheet("button", "cmp-button"),
		sheet("badge", "cmp-badge"),
		sheet("tooltip", "cmp-tooltip"),
	],
};
const SCREENS: Screen[] = SHEETS.sheets.map((s) => ({
	key: s.screen,
	title: s.title,
	url: `/g/${s.key}/raw/`,
}));

// Las que tienen captura válida
async function plan(
	names: readonly string[],
	options: { captured?: readonly string[]; sheets?: SheetsFile | null } = {},
) {
	const store = new InMemoryWebCaptureStore();
	for (const screen of options.captured ?? [
		"cmp-button",
		"cmp-badge",
		"cmp-tooltip",
	])
		await store.saveCapture(screen, "{}");
	const project = projectWith(
		SCREENS,
		{},
		null,
		null,
		{},
		{
			sheets: options.sheets === undefined ? SHEETS : options.sheets,
			sheetsSource: {
				path: "/p/sheets.json",
				sha256: "s".repeat(64),
				text: "{}",
			},
		},
	);
	return makeSheetsPlan({
		project: new InMemoryProjectConfig(project),
		store,
	})(names);
}

const labels = (r: Awaited<ReturnType<typeof plan>>) => {
	assert.ok(r.kind === "plan", JSON.stringify(r));
	return r.plan.steps.map((s) => s.file);
};

describe("makeSheetsPlan: el plan de un figma_build { sheets }", () => {
	it("un paso kit/build-component@1 por hoja, con su etiqueta, su paso del kit y formato body", async () => {
		const r = await plan(["badge"]);
		assert.deepEqual(labels(r), [
			kitStepLabel("kit/build-component@1", "badge"),
		]);
		assert.ok(r.kind === "plan");
		assert.deepEqual(r.plan.steps[0]?.kit, {
			step: "kit/build-component@1",
			sheet: "badge",
		});
		assert.equal(r.plan.steps[0]?.format, "body");
		assert.deepEqual(r.skipped, []);
	});

	it("los pasos van en el orden de sheets@1, no en el de la lista, y una hoja repetida cuenta una vez", async () => {
		const r = await plan(["tooltip", "button", "tooltip"]);
		assert.deepEqual(labels(r), [
			kitStepLabel("kit/build-component@1", "button"),
			kitStepLabel("kit/build-component@1", "tooltip"),
		]);
		assert.ok(r.kind === "plan");
		assert.equal(r.plan.name, "hojas: button, tooltip");
	});

	it("una hoja sin captura válida no tiene paso y sale en `skipped` con NO_SOURCE y qué hacer", async () => {
		const r = await plan(["button", "badge"], { captured: ["cmp-button"] });
		assert.deepEqual(labels(r), [
			kitStepLabel("kit/build-component@1", "button"),
		]);
		assert.ok(r.kind === "plan");
		assert.equal(r.skipped.length, 1);
		assert.equal(r.skipped[0]?.sheet, "badge");
		assert.equal(r.skipped[0]?.code, "NO_SOURCE");
		assert.match(r.skipped[0]?.message ?? "", /cmp-badge.*figma_capture/);
	});

	it("si ninguna de las hojas pedidas tiene captura es un error de uso que las nombra", async () => {
		const r = await plan(["button", "badge"], { captured: [] });
		assert.ok(r.kind === "usage");
		assert.match(r.message, /NO_SOURCE/);
		assert.match(r.message, /button/);
		assert.match(r.message, /badge/);
	});

	it("una hoja desconocida es un error de uso con las que hay, aunque otras sí valgan", async () => {
		const r = await plan(["button", "fantasma"]);
		assert.ok(r.kind === "usage");
		assert.match(r.message, /«fantasma».*button, badge, tooltip/);
	});

	it("un proyecto sin `sheets` es ProjectConfigError con el campo `sheets`", async () => {
		const r = await plan(["button"], { sheets: null });
		assert.ok(r.kind === "error");
		assert.equal(
			r.error.type === "ProjectConfigError" && r.error.field,
			"sheets",
		);
	});
});
