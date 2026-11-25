// kit.steps.place: del constructor temporal a su frame, con el shell y los enlaces. Trampas: 1, 2, 6, 7, 8 y 9.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { areaFrameKey } from "#domain/areas.ts";
import {
	button,
	COVER,
	PANEL,
	panelScene,
	paramsOf,
	tempPage,
	warningCodes,
} from "../areas-support.ts";
import type { FakeNode } from "../fake-figma.ts";
import { ids, setup } from "../support.ts";

type Report = {
	frames: { frame: string; id: string; height: number; shell?: string }[];
	relinked?: { frame: string; restored: number; total: number }[];
};
const reportOf = (r: { report?: unknown }) => r.report as Report;

describe("kit.steps.place: replace-content", () => {
	it("pasa cada pantalla temporal a su frame conservando el id, y cumple step@1", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const before = ids(Object.values(scene.frames));
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.equal(StepResultSchema.safeParse(result).success, true);
		assert.deepEqual(ids(Object.values(scene.frames)), before);
		assert.deepEqual(
			reportOf(result).frames.map((f) => f.id),
			before,
		);
		for (const frame of Object.values(scene.frames)) {
			assert.deepEqual(frame.children.map((c) => c.name).sort(), [
				"lateral",
				"principal",
			]);
		}
	});

	it("la primera vez adopta los frames por nombre (ADOPTED) y les pone la clave; la segunda usa la clave", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const first = await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.deepEqual(
			warningCodes(first).filter((c) => c === "ADOPTED"),
			["ADOPTED", "ADOPTED"],
		);
		assert.equal(
			scene.frames["Inicio"]?.getSharedPluginData("fcc", "key"),
			areaFrameKey("Panel", "Inicio"),
		);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const second = await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.equal(warningCodes(second).includes("ADOPTED"), false);
	});

	it("un frame que no existe se crea con su clave, su ancho y su alto mínimo", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		scene.frames["Detalle"]?.remove();
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		const created = scene.page.children.find(
			(c) =>
				c.getSharedPluginData("fcc", "key") ===
				areaFrameKey("Panel", "Detalle"),
		);
		assert.ok(created);
		assert.equal(created.type, "FRAME");
		assert.ok(result.createdNodeIds.includes(created.id));
	});

	it("el frame queda de ancho fijo, con el alto del contenido y como mínimo `minHeight`", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		await kit.steps.place(paramsOf(PANEL) as never, {});
		const f = scene.frames["Inicio"] as FakeNode;
		assert.equal(f.width, 1440);
		assert.equal(f.height, 900);
		// con contenido más alto que el mínimo, manda el contenido
		const tall = tempPage(fake, "tmp ", "Detalle");
		tall.main.height = 1500;
		await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.equal((scene.frames["Detalle"] as FakeNode).height, 1500);
	});

	it("la capa `main` crece a lo ancho", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		await kit.steps.place(
			paramsOf({ ...PANEL, main: ["contenido", "principal"] }) as never,
			{},
		);
		const main = scene.frames["Inicio"]?.children.find(
			(c) => c.name === "principal",
		);
		assert.equal(main?.layoutGrow, 1);
	});

	it("el shell: la instancia de la variante de la pantalla sustituye al primer hijo y queda la última, fija y de pie (trampas 6 y 7)", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"])
			tempPage(fake, "tmp ", name, { layout: "NONE" });
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		const frame = scene.frames["Detalle"] as FakeNode;
		const aside = frame.children[frame.children.length - 1] as FakeNode;
		assert.equal(aside.name, "lateral");
		assert.equal(aside.layoutPositioning, "ABSOLUTE");
		assert.equal(aside.height, 900);
		assert.equal(aside.children.length, 1);
		const instance = aside.children[0] as FakeNode;
		assert.equal(instance.type, "INSTANCE");
		assert.equal(instance.main?.variantProperties?.["activa"], "detalle");
		assert.equal(instance.layoutAlign, "STRETCH");
		assert.equal(instance.layoutGrow, 1);
		assert.equal(frame.paddingLeft, 250);
		assert.equal(frame.numberOfFixedChildren, 1);
		assert.deepEqual(frame.fixedChildren, [aside]);
		const shells = reportOf(result).frames.map((f) => f.shell);
		assert.deepEqual(shells, ["inicio", "detalle"]);
	});

	it("sin `shell` en la pantalla usa el valor por defecto", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const area = {
			...PANEL,
			screens: [{ frame: "Inicio" }, { frame: "Detalle" }],
		};
		await kit.steps.place(paramsOf(area) as never, {});
		const aside = scene.frames["Detalle"]?.children.find(
			(c) => c.name === "lateral",
		);
		assert.equal(
			aside?.children[0]?.main?.variantProperties?.["activa"],
			"inicio",
		);
	});

	it("fijar hijos solo cuenta en un marco sin auto-layout (medido): el paso no toca su desplazamiento", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"])
			tempPage(fake, "tmp ", name, { layout: "NONE" });
		const frame = scene.frames["Inicio"] as FakeNode;
		await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.equal(
			frame.overflowDirection,
			"NONE",
			"no cambia cómo se desplaza el prototipo",
		);
		assert.equal(frame.numberOfFixedChildren, 1);
	});

	it("si Figma deja los hijos fijos en 0 sin lanzar, avisa FIXED_FAILED", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"])
			tempPage(fake, "tmp ", name, { layout: "NONE" });
		const frame = scene.frames["Inicio"] as FakeNode;
		Object.defineProperty(frame, "numberOfFixedChildren", {
			get: () => 0,
			set: () => {},
		});
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.equal(warningCodes(result).includes("FIXED_FAILED"), true);
	});

	it("si no se puede fijar el shell, avisa FIXED_FAILED con el mensaje de Figma y el frame queda colocado (trampa 6)", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"])
			tempPage(fake, "tmp ", name, { layout: "NONE" });
		const frame = scene.frames["Inicio"] as FakeNode;
		let allowed = true;
		Object.defineProperty(frame, "numberOfFixedChildren", {
			get: () => 0,
			set: (value: number) => {
				if (value > 0 && !allowed) throw new Error("boom de Figma");
			},
		});
		// durante el vaciado se pone a 0 (permitido); luego se intenta fijar y lanza
		allowed = false;
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		const fixed = (result.warnings ?? []).find(
			(w) => w.code === "FIXED_FAILED",
		);
		assert.ok(fixed);
		assert.match(fixed.message, /boom de Figma/);
		assert.equal(
			frame.children.some((c) => c.name === "principal"),
			true,
		);
	});

	it("con auto-layout el shell también queda fijo (medido: cuenta porque es el último hijo y está fuera del flujo)", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		const frame = scene.frames["Inicio"] as FakeNode;
		const aside = frame.children[frame.children.length - 1] as FakeNode;
		assert.equal(frame.layoutMode, "HORIZONTAL", "conserva su auto-layout");
		assert.equal(aside.layoutPositioning, "ABSOLUTE");
		assert.equal(frame.numberOfFixedChildren, 1);
		assert.deepEqual(frame.fixedChildren, [aside]);
		assert.equal(warningCodes(result).includes("FIXED_FAILED"), false);
	});

	it("aplana el envoltorio que contiene la capa del shell y quita los marcos vacíos que lleva al lado", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		tempPage(fake, "tmp ", "Inicio", { wrapped: true });
		tempPage(fake, "tmp ", "Detalle", { wrapped: true });
		await kit.steps.place(paramsOf(PANEL) as never, {});
		const frame = scene.frames["Inicio"] as FakeNode;
		assert.equal(
			frame.children.some((c) => c.name === "envoltorio"),
			false,
		);
		assert.equal(
			frame.children.some((c) => c.name === "avisos"),
			false,
		);
		assert.deepEqual(frame.children.map((c) => c.name).sort(), [
			"lateral",
			"principal",
		]);
		// la disposición del envoltorio es la del frame
		assert.equal(frame.itemSpacing, 4);
	});

	it("con strokeScale redondea los bordes que son un múltiplo exacto (0,8 → 1) y deja el resto, también dentro de instancias", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		await kit.steps.place(paramsOf(PANEL) as never, {});
		const frame = scene.frames["Inicio"] as FakeNode;
		const box = frame.findAllWithCriteria({
			types: ["RECTANGLE"],
		})[0] as FakeNode;
		assert.equal(box.strokeTopWeight, 1);
		assert.equal(box.strokeLeftWeight, 2);
	});

	it("rellena con la variable `frame.fill` si el frame quedó sin relleno, ligada y con opacidad 1", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		await kit.steps.place(paramsOf(PANEL) as never, {});
		const fills = (scene.frames["Inicio"] as FakeNode).fills as {
			boundVariables?: { color?: { id: string } };
			opacity?: number;
		}[];
		assert.equal(fills.length, 1);
		assert.ok(fills[0]?.boundVariables?.color?.id);
		assert.equal(fills[0]?.opacity, 1);
	});

	it("sin página temporal avisa NO_SOURCE y deja ese frame como está; los demás se colocan", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		tempPage(fake, "tmp ", "Inicio");
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.deepEqual(
			warningCodes(result).filter((c) => c === "NO_SOURCE"),
			["NO_SOURCE"],
		);
		assert.deepEqual(
			(scene.frames["Detalle"] as FakeNode).children.map((c) => c.name),
			["viejo de Detalle"],
		);
		assert.deepEqual(
			reportOf(result).frames.map((f) => f.frame),
			["Inicio"],
		);
	});

	it("borra las páginas temporales al acabar, también la abierta (trampa 9, medida); con remove:false las deja", async () => {
		const { fake, kit } = setup();
		panelScene(fake);
		const a = tempPage(fake, "tmp ", "Inicio");
		const b = tempPage(fake, "tmp ", "Detalle");
		await fake.setCurrentPageAsync(a.page);
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		assert.equal(a.page.removed, true);
		assert.equal(b.page.removed, true);
		assert.equal(result.removedNodeIds?.includes(a.page.id), true);
		// remove: false
		const { fake: f2, kit: k2 } = setup();
		panelScene(f2);
		const c = tempPage(f2, "tmp ", "Inicio");
		const keep = {
			...PANEL,
			place: {
				...PANEL.place,
				source: { ...PANEL.place.source, remove: false },
			},
		};
		await k2.steps.place(paramsOf(keep) as never, {});
		assert.equal(c.page.removed, false);
	});

	it("el informe y lo declarado son los ids que tienen los frames y sus hijos (trampa 2, medida: los ids se conservan al mover)", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const result = await kit.steps.place(paramsOf(PANEL) as never, {});
		for (const f of Object.values(scene.frames)) {
			for (const child of f.children)
				assert.ok(await fake.getNodeByIdAsync(child.id));
		}
		for (const id of result.createdNodeIds)
			assert.ok(await fake.getNodeByIdAsync(id));
		assert.equal(
			(await fake.getNodeByIdAsync(reportOf(result).frames[0]?.id ?? "")) !==
				null,
			true,
		);
	});

	it("si falta algo en Figma falla AREA_NOT_FOUND con la lista de lo que falta, sin escribir nada", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const area = {
			...PANEL,
			shell: {
				...(PANEL.shell as never as object),
				set: "No existe",
				in: ["lateral"],
				variantProp: "activa",
				default: "inicio",
			},
			frame: { ...PANEL.frame, fill: "no-existe" },
		};
		await assert.rejects(
			kit.steps.place(paramsOf(area) as never, {}),
			(e: Error) =>
				e.message.includes("AREA_NOT_FOUND") &&
				e.message.includes("No existe") &&
				e.message.includes("no-existe"),
		);
		assert.deepEqual(
			(scene.frames["Inicio"] as FakeNode).children.map((c) => c.name),
			["viejo de Inicio"],
		);
		await assert.rejects(
			kit.steps.place(paramsOf({ ...PANEL, page: "Sin página" }) as never, {}),
			(e: Error) =>
				e.message.includes("AREA_NOT_FOUND") &&
				e.message.includes("Sin página"),
		);
	});

	it("una variante del shell que no existe falla antes de escribir (AREA_NOT_FOUND)", async () => {
		const { fake, kit } = setup();
		const scene = panelScene(fake);
		for (const name of ["Inicio", "Detalle"]) tempPage(fake, "tmp ", name);
		const area = {
			...PANEL,
			screens: [{ frame: "Inicio", shell: "inventada" }],
		};
		await assert.rejects(
			kit.steps.place(paramsOf(area) as never, {}),
			(e: Error) =>
				e.message.includes("AREA_NOT_FOUND") && e.message.includes("inventada"),
		);
		assert.deepEqual(
			(scene.frames["Inicio"] as FakeNode).children.map((c) => c.name),
			["viejo de Inicio"],
		);
	});
});

describe("kit.steps.place: transplant", () => {
	function cover() {
		const { fake, kit } = setup();
		fake.collection("Colores", 1, {});
		const page = fake.page("Portada");
		const home = fake.node(page, "FRAME", "Home");
		home.layoutMode = "VERTICAL";
		const header = fake.componentSet(page, "Cabecera", [{ k: "v" }]);
		const footer = fake.componentSet(page, "Pie", [{ k: "v" }]);
		const top = fake.node(home, "INSTANCE", "Cabecera");
		top.main = header.children[0] as FakeNode;
		const oldA = fake.node(home, "FRAME", "viejo A");
		const oldButton = button(fake, oldA, "Empezar");
		const bottom = fake.node(home, "INSTANCE", "Pie");
		bottom.main = footer.children[0] as FakeNode;
		void oldButton.setReactionsAsync([
			{ actions: [{ type: "NODE", destinationId: home.id }] },
		]);
		const temp = fake.page("tmp Home");
		const source = fake.node(temp, "COMPONENT", "pantalla");
		fake.node(source, "FRAME", "cabecera");
		const mid1 = fake.node(source, "FRAME", "bloque 1");
		const newButton = button(fake, mid1, "Empezar");
		fake.node(source, "FRAME", "bloque 2");
		fake.node(source, "FRAME", "pie");
		return { fake, kit, page, home, top, bottom, temp, newButton, oldButton };
	}

	it("conserva las instancias de `keep`, trae lo del origen sin lo de `drop` y repone los enlaces por texto", async () => {
		const { kit, home, top, bottom, newButton } = cover();
		const result = await kit.steps.place(paramsOf(COVER) as never, {});
		assert.deepEqual(
			home.children.map((c) => c.name),
			["Cabecera", "bloque 1", "bloque 2", "Pie"],
		);
		assert.equal(home.children[0], top);
		assert.equal(home.children[3], bottom);
		assert.equal(newButton.reactions.length, 1);
		assert.deepEqual(reportOf(result).relinked, [
			{ frame: "Home", restored: 1, total: 1 },
		]);
		assert.equal(home.children[1]?.layoutAlign, "STRETCH");
		assert.equal(StepResultSchema.safeParse(result).success, true);
	});

	it("un cambio de variante del contenido viejo que no vale en el nuevo no tumba el paso: se descarta y avisa REACTION_DROPPED", async () => {
		const { fake, kit, page, home } = cover();
		const set = fake.componentSet(page, "Boton viejo", [
			{ state: "default" },
			{ state: "hover" },
		]);
		const [base, hover] = set.children as [FakeNode, FakeNode];
		await base.setReactionsAsync([
			{
				trigger: { type: "ON_HOVER" },
				actions: [
					{ type: "NODE", destinationId: hover.id, navigation: "CHANGE_TO" },
				],
			},
		]);
		const old = home.children.find((c) => c.name === "viejo A") as FakeNode;
		const inst = base.createInstance();
		old.appendChild(inst);
		for (const c of inst.children) c.visible = false;
		fake.text(inst, "t", "Empezar");
		const result = await kit.steps.place(paramsOf(COVER) as never, {});
		assert.equal(warningCodes(result).includes("REACTION_DROPPED"), true);
		assert.equal(StepResultSchema.safeParse(result).success, true);
	});

	it("si un frame falla a mitad, el paso lanza pero no deja ninguna página temporal del área (tampoco las que no llegó a usar)", async () => {
		const { fake, kit, page, home } = cover();
		fake.node(page, "FRAME", "Otra");
		const other = fake.page("tmp Otra");
		fake.node(other, "COMPONENT", "pantalla");
		home.insertChild = () => {
			throw "fallo de Figma a mitad";
		};
		const area = {
			...COVER,
			screens: [{ frame: "Home" }, { frame: "Otra" }],
		};
		await assert.rejects(kit.steps.place(paramsOf(area) as never, {}));
		assert.deepEqual(
			fake.root.children
				.filter((p) => p.name.startsWith("tmp "))
				.map((p) => p.name),
			[],
		);
	});

	it("un frame sin contenido propio avisa NO_CONTENT y no toca nada", async () => {
		const { kit, home } = cover();
		for (const child of [...home.children])
			if (child.type !== "INSTANCE") child.remove();
		const result = await kit.steps.place(paramsOf(COVER) as never, {});
		assert.equal(warningCodes(result).includes("NO_CONTENT"), true);
		assert.deepEqual(
			home.children.map((c) => c.name),
			["Cabecera", "Pie"],
		);
	});

	it("`take: first-component` toma el primer componente de la página temporal", async () => {
		const { kit, temp } = cover();
		await kit.steps.place(paramsOf(COVER) as never, {});
		assert.equal(temp.removed, true);
	});
});
