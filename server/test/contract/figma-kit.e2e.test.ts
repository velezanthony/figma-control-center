// make kit-contract (opt-in, FCC_E2E=1): las piezas del kit de Figma (figma-kit@1) contra Figma REAL, solo contra el
// archivo de pruebas de FIGMA_TEST_FILE_URL. Es la prueba de verdad de lo que simula el doble
// (server/test/kits/figma/fake-figma.ts): si Figma cambia una de sus trampas, el doble sigue verde y esto no.
//
// Guardas, antes de escribir nada: `requireTestFile` sobre FIGMA_TEST_FILE_URL y la pestaña elegida es la de ese archivo
// por su fileKey.
// Todo lo que se crea cuelga de una página con clave propia (`fcc:kit-test`) y de colecciones con prefijo `fcc-kit-`;
// se borra al acabar, también si una prueba falla.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { CdpClient } from "#adapters/cdp/cdp-client.ts";
import { CdpFigmaGateway } from "#adapters/cdp/cdp-figma-gateway.ts";
import { readFigmaKitBundle } from "#adapters/cdp/figma-kit.ts";
import { bootLayered } from "#adapters/config/env.ts";
import { SCRIPT_FORMAT } from "#application/ports/figma-gateway.ts";
import {
	assertTestingFile,
	requireTestFile,
} from "../support/test-file-guard.ts";
import { openTestingTab, type RawSession } from "./raw-cdp.ts";

const { machine } = bootLayered;

const PAGE_KEY = "fcc:kit-test";
const PAGE_NAME = "fcc kit test";
// F3: una segunda página (lo de dos páginas) y el prefijo de todo lo que crean los casos de áreas; el `cleanup` quita las
// páginas cuya clave empieza por estos prefijos
const PAGE_KEY_2 = "fcc:kit-test-2";
const PAGE_NAME_2 = "fcc kit test 2";
const KEY_PREFIXES = [
	"fcc:kit-test",
	// La clave de antes: una página que quedó de una ejecución anterior también se quita
	"fcc:kit-prueba",
	"fcc:shared:fcc-kit-",
	"fcc:screen-page:fcc-kit",
	"fcc:sheet-scratch:fcc-kit",
	"fcc:sheet-page:fcc-kit",
	"fcc:compose-page:fcc-kit",
];
const COLLECTION = "fcc-kit-test";
// La hoja mínima trae su propia colección de un solo modo (otros casos dejan una `fcc-kit-test` con otras variables)
const SHEET_COLLECTION = "fcc-kit-sheet";
// Los nombres de antes de las dos colecciones: lo que quedó de una ejecución anterior también se quita
const LEGACY_COLLECTIONS = ["fcc-kit-prueba", "fcc-kit-hoja"];
const CALL_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 15_000;

// Un PNG de verdad (gris, 8 bits) de ese tamaño: Figma decodifica la imagen entera, no le vale una cabecera sola
function png(width: number, height: number): string {
	const chunk = (type: string, data: Buffer) => {
		const head = Buffer.alloc(8);
		head.writeUInt32BE(data.length, 0);
		head.write(type, 4, "latin1");
		const body = Buffer.concat([head.subarray(4), data]);
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc32(body), 0);
		return Buffer.concat([head, data, tail]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 0;
	const rows = Buffer.alloc((width + 1) * height);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(rows)),
		chunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}

describe("kit de Figma contra Figma real (archivo de pruebas)", {
	skip: !machine.e2e.enabled,
}, () => {
	let session: RawSession;
	let gateway: CdpFigmaGateway;
	let client: CdpClient;

	// Un paso de usuario: recibe `kit` y `params`. Devuelve el valor que da el script o hace fallar la prueba con su error
	// biome-ignore lint/suspicious/noExplicitAny: el valor lo arma el script de cada prueba y cada prueba lo comprueba
	const step = async (code: string, params?: unknown): Promise<any> => {
		const result = await gateway.run(
			{
				code,
				format: SCRIPT_FORMAT.body,
				...(params !== undefined && { params }),
			},
			{ installKit: true, timeoutMs: CALL_TIMEOUT_MS },
		);
		if (!result.ok) {
			assert.fail(
				`${result.error.type}: ${result.error.message} (${result.error.nextStep})`,
			);
		}
		return result.value;
	};

	// Quita lo que dejó una ejecución anterior o la actual: la página de pruebas y las colecciones de variables
	const cleanup = () =>
		step(
			`const t = kit.track();
			const page = await kit.node.byKey(${JSON.stringify(PAGE_KEY)}) ?? null;
			for (const p of [...figma.root.children]) {
				const key = p.getSharedPluginData('fcc', 'key');
				if (${JSON.stringify(KEY_PREFIXES)}.some((prefix) => key.startsWith(prefix))) await kit.page.remove(p);
			}
			for (const style of await figma.getLocalTextStylesAsync()) {
				if (style.name.startsWith('fcc-kit/')) style.remove();
			}
			for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
				if (${JSON.stringify([COLLECTION, SHEET_COLLECTION, ...LEGACY_COLLECTIONS])}.includes(c.name)) c.remove();
			}
			return t.done({ page: page === null ? null : page.id });`,
		);

	before(async () => {
		const testFileUrl = requireTestFile(machine.figma.testFileUrl);
		// La pestaña del archivo de pruebas abierta en el Chrome de depuración, elegida por su fileKey
		session = await openTestingTab({
			host: machine.cdp.host,
			port: machine.cdp.port,
			testFileUrl,
		});
		assertTestingFile(session.tabUrl, testFileUrl);
		session.close();

		client = new CdpClient({
			host: machine.cdp.host,
			port: machine.cdp.port,
			fileUrl: testFileUrl,
			callTimeoutMs: CALL_TIMEOUT_MS,
			readyTimeoutMs: READY_TIMEOUT_MS,
		});
		gateway = new CdpFigmaGateway(client);
		const status = await gateway.status();
		assert.equal(status.error, null, status.error?.message ?? "");
		await cleanup();
	});

	after(async () => {
		try {
			if (gateway !== undefined) await cleanup();
		} finally {
			client?.close();
		}
	});

	it("instala el kit con su versión y su hash; instalarlo otra vez no lo reinstala", async () => {
		const bundle = readFigmaKitBundle();
		const first = await step(
			"return { version: kit.version, sha256: kit.sha256 };",
		);
		assert.deepEqual(first, { version: "figma-kit@1", sha256: bundle.sha256 });
		const again = await step("return kit.sha256;");
		assert.equal(again, bundle.sha256);
	});

	it("page.ensure y frame.ensure: repetir un paso por clave no duplica nada (mismo id)", async () => {
		const run = () =>
			step(`
				const t = kit.track();
				const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
				const frame = await kit.frame.ensure({ key: 'fcc:kit-test/marco', page, name: 'marco', width: 400, minHeight: 200 });
				const marcos = page.findAllWithCriteria({ types: ['FRAME'] }).filter((f) => f.getSharedPluginData('fcc', 'key') === 'fcc:kit-test/marco');
				return t.done({ page: page.id, frame: frame.id, marcos: marcos.length });`);
		const first = await run();
		const second = await run();
		assert.equal(first.report.marcos, 1);
		assert.equal(second.report.marcos, 1);
		assert.equal(second.report.frame, first.report.frame);
		assert.equal(second.report.page, first.report.page);
		assert.deepEqual(
			second.createdNodeIds,
			[],
			"la segunda ejecución no crea nada",
		);
	});

	it("node.tag y node.byKey: la clave va con setSharedPluginData (setPluginData falla fuera de un plugin)", async () => {
		const out = await step(`
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			const rect = figma.createRectangle();
			page.appendChild(rect);
			kit.node.tag(rect, 'fcc:kit-test/rect');
			const found = await kit.node.byKey('fcc:kit-test/rect', { page });
			return { same: found !== null && found.id === rect.id };`);
		assert.equal(out.same, true);
	});

	it("un set con una propiedad SLOT sin defaultValue se instancia; el kit lee sus propiedades sin fallar", async () => {
		const out = await step(`
			const t = kit.track();
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			const a = figma.createComponent(); a.name = 'tipo=a';
			const b = figma.createComponent(); b.name = 'tipo=b';
			page.appendChild(a); page.appendChild(b);
			const set = figma.combineAsVariants([a, b], page);
			set.name = 'fcc-kit-set-slot';
			a.createSlot();
			const defs = Object.values(set.componentPropertyDefinitions);
			const slot = defs.find((d) => d.type === 'SLOT');
			const instance = await kit.instance.create(set, { variant: { tipo: 'a' } });
			return { hasSlot: slot !== undefined, withoutDefault: slot !== undefined && !('defaultValue' in slot), instance: instance.id };`);
		assert.equal(out.hasSlot, true);
		assert.ok(out.instance);
	});

	it("una colección de un solo modo se lee por nombre; con más modos avisa (no falla) y usa el de por defecto", async () => {
		const out = await step(`
			const t = kit.track();
			const col = figma.variables.createVariableCollection(${JSON.stringify(COLLECTION)});
			const v = figma.variables.createVariable('rojo', col, 'COLOR');
			v.setValueForMode(col.defaultModeId, { r: 1, g: 0, b: 0 });
			const one = await kit.tokens.load([${JSON.stringify(COLLECTION)}]);
			const value = one.value('rojo');
			return t.done({ value, names: one.names() });`);
		assert.deepEqual(
			out.report.value,
			{ r: 1, g: 0, b: 0, a: 1 },
			"Figma devuelve los colores como RGBA",
		);
		assert.equal(out.warnings, undefined, "un solo modo: sin avisos");
	});

	it("clonar una variante repone las referencias a propiedades que clone() pierde", async () => {
		const out = await step(`
			const t = kit.track();
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
			const a = figma.createComponent(); a.name = 'tipo=a';
			const b = figma.createComponent(); b.name = 'tipo=b';
			page.appendChild(a); page.appendChild(b);
			for (const c of [a, b]) { const tx = figma.createText(); tx.characters = 'x'; c.appendChild(tx); }
			const set = figma.combineAsVariants([a, b], page);
			set.name = 'fcc-kit-set-clon';
			const key = set.addComponentProperty('Label', 'TEXT', 'x');
			a.children[0].componentPropertyReferences = { characters: key };
			const raw = a.clone();
			const rawLost = raw.children[0].componentPropertyReferences === null || raw.children[0].componentPropertyReferences.characters === undefined;
			raw.remove();
			const copy = kit.component.cloneVariant(a);
			const refs = copy.children[0].componentPropertyReferences;
			return { rawLost, restored: refs !== null && refs.characters === key };`);
		assert.equal(out.restored, true);
	});

	it("slot.share deja las variantes con un solo slot común y una sola propiedad SLOT", async () => {
		const out = await step(`
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			const a = figma.createComponent(); a.name = 'tipo=a';
			const b = figma.createComponent(); b.name = 'tipo=b';
			page.appendChild(a); page.appendChild(b);
			const set = figma.combineAsVariants([a, b], page);
			set.name = 'fcc-kit-set-slot-comun';
			const key = kit.slot.share([a, b], 'contenido');
			const slotProps = Object.keys(set.componentPropertyDefinitions).filter((k) => set.componentPropertyDefinitions[k].type === 'SLOT');
			const refs = [a, b].map((v) => v.findOne((n) => n.type === 'SLOT').componentPropertyReferences.slotContentId);
			return { key, slotProps, refs };`);
		assert.equal(out.slotProps.length, 1);
		assert.deepEqual(out.refs, [out.key, out.key]);
	});

	it("paints.set: una pintura ligada a una variable conserva su opacidad", async () => {
		const out = await step(`
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			let col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === ${JSON.stringify(COLLECTION)});
			if (!col) {
				col = figma.variables.createVariableCollection(${JSON.stringify(COLLECTION)});
				const v = figma.variables.createVariable('rojo', col, 'COLOR');
				v.setValueForMode(col.defaultModeId, { r: 1, g: 0, b: 0 });
			}
			const tokens = await kit.tokens.load([${JSON.stringify(COLLECTION)}]);
			const rect = figma.createRectangle();
			page.appendChild(rect);
			kit.paints.set(rect, 'fills', [{ bind: tokens.variable('rojo'), opacity: 0.4 }]);
			const fill = rect.fills[0];
			return { opacity: fill.opacity, bound: fill.boundVariables !== undefined && fill.boundVariables.color !== undefined };`);
		// Figma guarda la opacidad en coma flotante de 32 bits: vuelve 0.4000000059604645
		assert.ok(Math.abs(out.opacity - 0.4) < 1e-6, String(out.opacity));
		assert.equal(out.bound, true);
	});

	it("icons.fromSvg crea el icono con createNodeFromSvg y lo nombra", async () => {
		const out = await step(`
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512z"/></svg>';
			const icon = kit.icons.fromSvg('icons/fcc-prueba', svg, { size: 16 });
			page.appendChild(icon);
			return { name: icon.name, vectors: icon.findAllWithCriteria({ types: ['VECTOR'] }).length };`);
		assert.equal(out.name, "icons/fcc-prueba");
		assert.ok(out.vectors >= 1);
	});

	it("fonts.ensure carga lo que falta y escribir `characters` después no falla", async () => {
		const out = await step(`
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			const tx = figma.createText();
			page.appendChild(tx);
			await kit.fonts.ensure(tx);
			tx.characters = 'hola';
			return { characters: tx.characters };`);
		assert.equal(out.characters, "hola");
	});

	it("page.remove: borrar la página abierta funciona (pasa antes a otra)", async () => {
		const out = await step(`
			const t = kit.track();
			const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			await figma.setCurrentPageAsync(page);
			await kit.page.remove(page);
			const left = figma.root.children.filter((p) => p.getSharedPluginData('fcc', 'key') === ${JSON.stringify(PAGE_KEY)}).length;
			return t.done({ left });`);
		assert.equal(out.report.left, 0);
	});

	// --- F3: lo que el doble supone sin haberlo visto en Figma real. Cada caso afirma lo que supone el
	// doble (server/test/kits/figma/fake-figma.ts); si Figma hace otra cosa, el caso falla diciendo qué hizo y el doble se
	// cambia en el mismo commit que el hallazgo. ---

	// Las dos páginas de los casos de F3, vacías y abiertas la primera
	const TWO_PAGES = `
		const page1 = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
		const page2 = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY_2)}, name: ${JSON.stringify(PAGE_NAME_2)} });
		await figma.setCurrentPageAsync(page1);
		for (const c of [...page1.children, ...page2.children]) c.remove();
		page1.flowStartingPoints = []; page2.flowStartingPoints = [];`;

	it("replaceContent desde una página temporal conserva el id del marco; los ids de los hijos movidos (trampa 2) son los que da el marco", async () => {
		const out = await step(`
			const t = kit.track();${TWO_PAGES}
			const frame = figma.createFrame(); frame.name = 'marco'; page1.appendChild(frame);
			frame.appendChild(figma.createFrame());
			const source = figma.createComponent(); source.name = 'origen'; source.layoutMode = 'HORIZONTAL'; page2.appendChild(source);
			for (const n of ['A', 'B']) { const k = figma.createFrame(); k.name = n; source.appendChild(k); }
			const before = source.children.map((c) => c.id);
			const frameId = frame.id;
			const children = await kit.frame.replaceContent(frame, source, { copyLayout: true });
			const after = children.map((c) => c.id);
			const resolvable = [];
			for (const id of after) resolvable.push((await figma.getNodeByIdAsync(id)) !== null);
			const oldStillThere = [];
			for (const id of before) oldStillThere.push((await figma.getNodeByIdAsync(id)) !== null);
			return t.done({ frameId, frameIdAfter: frame.id, before, after, resolvable, oldStillThere, layout: frame.layoutMode });`);
		assert.equal(
			out.report.frameIdAfter,
			out.report.frameId,
			"el id del marco se conserva",
		);
		assert.deepEqual(
			out.report.resolvable,
			[true, true],
			"los ids que declara el kit se resuelven",
		);
		assert.equal(
			out.report.layout,
			"HORIZONTAL",
			"copyLayout copió la disposición",
		);
		// `createdNodeIds` también lleva las páginas que creó `page.ensure` en este paso: lo que importa es que estén los de ahora
		for (const id of out.report.after as string[])
			assert.ok(
				out.createdNodeIds.includes(id),
				`falta ${id} entre los creados`,
			);
		// Medido: los ids se conservan al mover entre páginas; la línea de abajo lo deja a la vista
		console.log(
			`[hallazgo trampa 2] ids de los hijos movidos entre páginas: antes ${JSON.stringify(out.report.before)}, después ${JSON.stringify(out.report.after)} → ${JSON.stringify(out.report.before) === JSON.stringify(out.report.after) ? "SE CONSERVAN" : "CAMBIAN"}`,
		);
	});

	it("una reacción a un frame de otra página (trampa 3): lo que hace Figma, y el kit la rechaza antes con LINK_OTHER_PAGE", async () => {
		const out = await step(`${TWO_PAGES}
			const a = figma.createFrame(); a.name = 'a'; page1.appendChild(a);
			const b = figma.createFrame(); b.name = 'b'; page2.appendChild(b);
			const button = figma.createFrame(); button.name = 'boton'; a.appendChild(button);
			let raw = { threw: false, message: '' };
			try {
				await button.setReactionsAsync([{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: b.id, navigation: 'NAVIGATE', transition: null, preserveScrollPosition: false }] }]);
			} catch (e) { raw = { threw: true, message: e.message }; }
			const kept = button.reactions.length;
			if (kept > 0) await button.setReactionsAsync([]);
			let guard = '';
			try { await kit.links.to(button, b, { transition: { type: 'DISSOLVE', easing: 'EASE_OUT', duration: 0.2 } }); }
			catch (e) { guard = e.message; }
			return { raw, kept, guard, after: button.reactions.length };`);
		console.log(
			`[hallazgo trampa 3] reacción a otra página: ${out.raw.threw ? `LANZA (${out.raw.message})` : `NO lanza (queda con ${out.kept} reacciones)`}`,
		);
		assert.equal(
			out.raw.threw,
			true,
			"el doble supone que Figma lanza ante un destino en otra página: si no lanza, cambia el doble (setReactionsAsync) y quita LINK_OTHER_PAGE solo si ya no hace falta",
		);
		assert.match(out.guard, /LINK_OTHER_PAGE/);
		assert.equal(out.after, 0);
	});

	it("una reacción en una capa de una instancia queda como cambio de la instancia y se relee (trampa 4)", async () => {
		const out = await step(`
			const t = kit.track();${TWO_PAGES}
			const dest = figma.createFrame(); dest.name = 'destino'; page1.appendChild(dest);
			const comp = figma.createComponent(); comp.name = 'tarjeta'; page1.appendChild(comp);
			const inner = figma.createFrame(); inner.name = 'pie'; comp.appendChild(inner);
			const instance = comp.createInstance(); page1.appendChild(instance);
			const layer = instance.findOne((n) => n.name === 'pie');
			const done = await kit.links.to(layer, dest, { transition: { type: 'DISSOLVE', easing: 'EASE_OUT', duration: 0.2 } });
			const again = await kit.links.to(layer, dest, { transition: { type: 'DISSOLVE', easing: 'EASE_OUT', duration: 0.2 } });
			return t.done({ done, again, reactions: layer.reactions.length, mainReactions: inner.reactions.length });`);
		assert.deepEqual(out.report.done, { changed: true });
		assert.equal(
			out.report.reactions,
			1,
			"la reacción se relee en la capa de la instancia",
		);
		assert.deepEqual(
			out.report.again,
			{ changed: false },
			"repetirlo no cambia nada",
		);
		console.log(
			`[hallazgo trampa 4] reacciones del componente principal tras ponerla en la instancia: ${out.report.mainReactions}`,
		);
	});

	it("transition.duration vuelve en 32 bits (trampa 5) y repetir el enlace no cambia nada", async () => {
		const out = await step(`${TWO_PAGES}
			const a = figma.createFrame(); a.name = 'a'; page1.appendChild(a);
			const b = figma.createFrame(); b.name = 'b'; page1.appendChild(b);
			const button = figma.createFrame(); button.name = 'boton'; a.appendChild(button);
			const transition = { type: 'DISSOLVE', easing: 'EASE_OUT', duration: 0.2 };
			await kit.links.to(button, b, { transition });
			const stored = button.reactions[0].actions[0].transition.duration;
			const again = await kit.links.to(button, b, { transition });
			return { stored, exact: stored === 0.2, again };`);
		console.log(
			`[hallazgo trampa 5] duration releída: ${out.stored} (${out.exact ? "exacta" : "32 bits"})`,
		);
		assert.ok(Math.abs(out.stored - 0.2) < 1e-6, String(out.stored));
		assert.deepEqual(out.again, { changed: false });
	});

	it("numberOfFixedChildren (trampas 6 y 7): sin auto-layout cuenta siempre; con él, solo si los últimos hijos están fuera del flujo", async () => {
		const out = await step(`${TWO_PAGES}
			const make = (layout, overflow, absolute) => {
				const frame = figma.createFrame(); frame.name = 'marco'; frame.resize(400, 300); page1.appendChild(frame);
				frame.layoutMode = layout;
				const main = figma.createFrame(); main.name = 'principal'; frame.appendChild(main);
				const aside = figma.createFrame(); aside.name = 'lateral'; frame.appendChild(aside);
				if (absolute) aside.layoutPositioning = 'ABSOLUTE';
				if (overflow) frame.overflowDirection = overflow;
				frame.numberOfFixedChildren = 1;
				return { fixed: frame.numberOfFixedChildren, last: frame.children[frame.children.length - 1].name };
			};
			return {
				plain: make('NONE', 'VERTICAL'),
				autoLayout: make('HORIZONTAL', 'VERTICAL'),
				autoLayoutAbsolute: make('HORIZONTAL', null, true),
				noOverflow: make('NONE', null),
			};`);
		assert.equal(
			out.plain.fixed,
			1,
			"sin auto-layout y con desplazamiento vertical se fija",
		);
		assert.equal(out.plain.last, "lateral", "el shell se añadió el último");
		assert.equal(
			out.autoLayout.fixed,
			0,
			"medido: con auto-layout y el último hijo en flujo se lee 0 (no lanza)",
		);
		assert.equal(
			out.autoLayoutAbsolute.fixed,
			1,
			"medido (2026-11-15): con auto-layout cuenta si el último hijo está fuera del flujo (ABSOLUTE)",
		);
		assert.equal(
			out.noOverflow.fixed,
			1,
			"medido: sin auto-layout se fija aunque el marco no se desplace",
		);
	});

	it("flowStartingPoints con dos puntos: kit.flow.start conserva el otro (trampa 12)", async () => {
		const out = await step(`const t = kit.track();${TWO_PAGES}
			const a = figma.createFrame(); a.name = 'a'; page1.appendChild(a);
			const b = figma.createFrame(); b.name = 'b'; page1.appendChild(b);
			page1.flowStartingPoints = [{ nodeId: b.id, name: 'Móvil' }];
			const first = kit.flow.start(page1, a, 'Escritorio');
			const second = kit.flow.start(page1, a, 'Escritorio');
			return t.done({ first, second, names: page1.flowStartingPoints.map((p) => p.name) });`);
		assert.deepEqual(out.report.names, ["Móvil", "Escritorio"]);
		assert.deepEqual(out.report.first, { changed: true });
		assert.deepEqual(out.report.second, { changed: false });
	});

	it("quitar la variante de un set deja las instancias de otros frames sin componente (trampa 13): qué queda", async () => {
		const out = await step(`${TWO_PAGES}
			const a = figma.createComponent(); a.name = 'area=uno'; page1.appendChild(a);
			const b = figma.createComponent(); b.name = 'area=dos'; page1.appendChild(b);
			const set = figma.combineAsVariants([a, b], page1);
			const variant = set.children.find((c) => c.name === 'area=uno');
			const outside = figma.createFrame(); page2.appendChild(outside);
			const instance = variant.createInstance(); outside.appendChild(instance);
			const before = (await variant.getInstancesAsync()).length;
			variant.remove();
			const exists = (await figma.getNodeByIdAsync(instance.id)) !== null;
			const main = exists ? await instance.getMainComponentAsync() : 'borrada';
			return { before, exists, type: exists ? instance.type : null, mainIsNull: main === null, main: main === null || typeof main === 'string' ? main : main.name };`);
		console.log(
			`[hallazgo trampa 13, medido] instancia fuera tras quitar su variante: existe=${out.exists} tipo=${out.type} sin componente=${out.mainIsNull} main=${JSON.stringify(out.main)}`,
		);
		assert.equal(out.before, 1);
		assert.equal(
			out.exists,
			true,
			"el doble supone que la instancia sigue existiendo",
		);
		assert.equal(out.type, "INSTANCE");
		assert.equal(
			out.mainIsNull,
			false,
			"medido: la instancia sigue apuntando al componente quitado (getMainComponentAsync no da null)",
		);
	});

	it("createImage: un PNG pequeño se crea y uno de 4097 px por lado falla (trampa 14); el kit lo rechaza antes con IMAGE_UNSUPPORTED", async () => {
		const out = await step(
			`${TWO_PAGES}
			const small = figma.createImage(figma.base64Decode(params.small));
			let big = { threw: false, message: '' };
			try { figma.createImage(figma.base64Decode(params.big)); } catch (e) { big = { threw: true, message: e.message }; }
			return { hash: small.hash, big };`,
			{ small: png(8, 8), big: png(4097, 1) },
		);
		assert.match(out.hash, /^[0-9a-f]+$/);
		console.log(
			`[hallazgo trampa 14] imagen de 4097 px: ${out.big.threw ? `LANZA (${out.big.message})` : "NO lanza"}`,
		);
		assert.equal(
			out.big.threw,
			true,
			"el doble supone que Figma rechaza más de 4096 px por lado",
		);
	});

	// Un área mínima de punta a punta con los cuatro pasos del kit: es lo que el doble NO puede probar (las propiedades de
	// disposición, los componentes y las imágenes de verdad). Genérica: nada de ningún proyecto.
	const AREA_PARAMS = (stepName: string) => ({
		area: {
			name: "fcc-kit-area",
			page: PAGE_NAME,
			frame: { width: 800, minHeight: 400, clip: true },
			place: {
				mode: "replace-content",
				source: { pagePrefix: "fcc kit tmp ", take: "first-variant" },
			},
			shell: {
				set: "fcc-kit-shell",
				in: ["lateral"],
				variantProp: "activa",
				default: "uno",
				fixed: { height: 400 },
			},
			main: ["principal"],
			screens: [
				{ frame: "Inicio", shell: "uno" },
				{ frame: "Detalle", shell: "dos" },
			],
			links: [
				{ from: "Inicio", text: "Ir al detalle", to: "Detalle" },
				{ from: "Inicio", text: "Botón que no existe", to: "Detalle" },
			],
			flowStart: { frame: "Inicio", name: "fcc-kit" },
			fills: [
				{
					frame: "Detalle",
					find: { text: "MAPA", minSize: [100, 50] },
					asset: "mapa.png",
					name: "mapa",
				},
			],
		},
		linkRules: {
			clickable: { names: ["boton"], namePrefixes: [], components: [] },
			rows: { row: ["fila"], body: ["cuerpo"] },
			transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
		},
		shared: [
			{
				name: "fcc-kit-grupo",
				set: "fcc-kit-compartido",
				page: { name: "fcc kit compartido" },
				part: ["principal"],
				variantProp: "area",
				from: [{ area: "fcc-kit-area", frame: "Inicio", value: "uno" }],
				sheet: { gap: 20, padding: 20 },
			},
		],
		step: stepName,
	});
	const SCENE = `
		await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
		const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
		await figma.setCurrentPageAsync(page);
		for (const c of [...page.children]) c.remove();
		const text = (parent, chars) => { const t = figma.createText(); t.characters = chars; parent.appendChild(t); return t; };
		// el shell: un set con una variante por pantalla
		const comps = [];
		for (const v of ['uno', 'dos']) { const c = figma.createComponent(); c.name = 'activa=' + v; c.resize(200, 400); text(c, 'menu ' + v); page.appendChild(c); comps.push(c); }
		const shell = figma.combineAsVariants(comps, page); shell.name = 'fcc-kit-shell';
		// los frames del área, con algo viejo
		for (const name of ['Inicio', 'Detalle']) { const f = figma.createFrame(); f.name = name; page.appendChild(f); f.appendChild(figma.createFrame()); }
		// las páginas temporales con lo que habría construido un constructor: variante con shell (lateral) y contenido (principal)
		const temp = [];
		for (const name of ['Inicio', 'Detalle']) {
			const p = await kit.page.ensure({ key: 'fcc:kit-test-tmp-' + name, name: 'fcc kit tmp ' + name });
			const set = figma.createComponent(); set.name = 'estado=base'; p.appendChild(set);
			const holder = figma.combineAsVariants([set], p); holder.name = 'Pantalla';
			set.layoutMode = 'HORIZONTAL';
			const side = figma.createFrame(); side.name = 'lateral'; side.resize(200, 400); side.appendChild(figma.createFrame()); set.appendChild(side);
			const main = figma.createFrame(); main.name = 'principal'; main.layoutMode = 'VERTICAL'; main.resize(600, 300); set.appendChild(main);
			const button = figma.createFrame(); button.name = 'boton'; text(button, 'Ir al detalle'); main.appendChild(button);
			const map = figma.createFrame(); map.name = 'mapa-falso'; map.resize(400, 200); text(map, 'MAPA'); main.appendChild(map);
			temp.push(p);
		}`;

	it("kit/place@1, share, links y fill-image de un área mínima con Figma real; repetir links no cambia nada", async () => {
		const out = await step(
			`const t = kit.track();${SCENE}
			const result = {};
			for (const name of ['place', 'share', 'links', 'fillImage']) {
				const params = ${JSON.stringify(AREA_PARAMS("x"))};
				const r = await kit.steps[name](params, { 'mapa.png': figma.base64Decode(PNG) });
				result[name] = { warnings: (r.warnings ?? []).map((w) => w.code), report: r.report, created: r.createdNodeIds.length, mutated: r.mutatedNodeIds.length };
			}
			const again = await kit.steps.links(${JSON.stringify(AREA_PARAMS("x"))}, {});
			const frames = page.children.filter((c) => c.type === 'FRAME').map((f) => ({ name: f.name, key: f.getSharedPluginData('fcc', 'key'), children: f.children.map((c) => c.name), fixed: f.numberOfFixedChildren, width: f.width, height: f.height }));
			const tmpLeft = figma.root.children.filter((p) => p.name.startsWith('fcc kit tmp ')).length;
			return t.done({ result, againLinks: again.report.links, againMutated: again.mutatedNodeIds, frames, tmpLeft });`.replace(
				"PNG",
				JSON.stringify(png(8, 8)),
			),
		);
		const r = out.report;
		console.log(
			`[kit/place@1..fill-image@1 reales] avisos: ${JSON.stringify(Object.fromEntries(Object.entries(r.result as Record<string, { warnings: string[] }>).map(([k, v]) => [k, v.warnings])))}`,
		);
		assert.equal(r.tmpLeft, 0, "las páginas temporales se borran");
		assert.deepEqual(
			(r.frames as { name: string }[]).map((f) => f.name).sort(),
			["Detalle", "Inicio"],
			"los frames del área siguen siendo dos",
		);
		for (const f of r.frames as {
			key: string;
			width: number;
			height: number;
		}[]) {
			assert.match(f.key, /^fcc:area:fcc-kit-area\//);
			assert.equal(f.width, 800);
			assert.ok(f.height >= 400);
		}
		assert.equal(r.result.links.report.links[0].count, 1);
		assert.equal(
			r.result.links.report.links[1].count,
			0,
			"el enlace a un texto que no existe cuenta 0",
		);
		assert.ok(r.result.links.warnings.includes("LINK_ZERO"));
		assert.equal(r.result.fillImage.report.fills.length, 1);
		for (const l of r.againLinks)
			assert.equal(l.unchanged, l.count, "repetir links: todo sin cambios");
		assert.deepEqual(r.againMutated, []);
		assert.equal(r.result.share.report.shared.length, 1);
	});

	// --- F4a: el pintor de pantallas (trampas 10 a 24, la 23 es de F4b). Cada caso afirma lo que supone
	// el doble de `kit.screen` y escribe `[hallazgo trampa N]` con lo que hizo Figma. Si Figma hace otra cosa, el doble cambia en el
	// mismo commit que el hallazgo. Todo cuelga de la página de pruebas y se borra al acabar. ---
	const PREP = `
		await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
		await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
		const page = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
		await figma.setCurrentPageAsync(page);
		for (const c of [...page.children]) c.remove();`;

	it("trampa 10 (sin verificar): tocar interlineado, interletraje o mayúsculas desengancha el estilo de texto", async () => {
		const out = await step(`${PREP}
			const style = figma.createTextStyle();
			style.name = 'fcc-kit-estilo-texto'; style.fontName = { family: 'Inter', style: 'Regular' }; style.fontSize = 14; style.lineHeight = { unit: 'PIXELS', value: 20 };
			const result = {};
			try {
				for (const [prop, value] of [['lineHeight', { unit: 'PIXELS', value: 22 }], ['letterSpacing', { unit: 'PIXELS', value: 1 }], ['textCase', 'UPPER'], ['fontSize', 16]]) {
					const t = figma.createText(); page.appendChild(t); t.characters = 'x'; t.fontSize = 14;
					await t.setTextStyleIdAsync(style.id);
					const before = t.textStyleId === style.id;
					t[prop] = value;
					result[prop] = { attached: before, after: t.textStyleId === style.id ? 'ENGANCHADO' : 'DESENGANCHADO' };
				}
			} finally { style.remove(); }
			return result;`);
		console.log(`[hallazgo trampa 10] ${JSON.stringify(out)}`);
		for (const prop of ["lineHeight", "letterSpacing", "textCase"]) {
			assert.equal(
				out[prop].attached,
				true,
				`${prop}: el estilo debería engancharse al ponerlo`,
			);
			assert.equal(
				out[prop].after,
				"DESENGANCHADO",
				`${prop}: Figma no desengancha el estilo (el doble sí): ${JSON.stringify(out)}`,
			);
		}
	});

	it("trampa 11 (sin verificar): tamaño, interlineado e interletraje en píxeles vuelven en 32 bits", async () => {
		const out = await step(`${PREP}
			const t = figma.createText(); page.appendChild(t); t.characters = 'x';
			t.fontSize = 13.3; t.lineHeight = { unit: 'PIXELS', value: 18.7 }; t.letterSpacing = { unit: 'PIXELS', value: 0.3 };
			return { size: t.fontSize, lh: t.lineHeight.value, ls: t.letterSpacing.value };`);
		console.log(
			`[hallazgo trampa 11] ${JSON.stringify(out)} → ${out.size === 13.3 && out.lh === 18.7 && out.ls === 0.3 ? "exactos" : "32 bits"}`,
		);
		assert.ok(
			Math.abs(out.size - 13.3) < 0.01 &&
				Math.abs(out.lh - 18.7) < 0.01 &&
				Math.abs(out.ls - 0.3) < 0.01,
		);
	});

	it("trampa 12 (sin verificar): estilos por tramos en un texto con dos fuentes", async () => {
		const out = await step(`${PREP}
			const t = figma.createText(); page.appendChild(t); t.fontName = { family: 'Inter', style: 'Regular' }; t.characters = 'ab';
			t.setRangeFontName(0, 1, { family: 'Inter', style: 'Bold' }); t.setRangeFontSize(0, 1, 20); t.setRangeTextDecoration(0, 1, 'UNDERLINE');
			const segs = t.getStyledTextSegments(['fontName', 'fontSize', 'textDecoration']);
			return { mixed: t.fontName === figma.mixed, segs: segs.map((s) => [s.characters, s.fontName.style, s.fontSize, s.textDecoration]) };`);
		console.log(`[hallazgo trampa 12] ${JSON.stringify(out)}`);
		assert.equal(out.mixed, true);
		assert.deepEqual(out.segs[0], ["a", "Bold", 20, "UNDERLINE"]);
		assert.deepEqual([out.segs[1][0], out.segs[1][1]], ["b", "Regular"]);
	});

	it("trampa 13: layoutGrow y layoutAlign en un hijo de un marco SIN auto-layout no lanzan; el tamaño FILL sí", async () => {
		const out = await step(`${PREP}
			const parent = figma.createFrame(); page.appendChild(parent);
			const child = figma.createFrame(); parent.appendChild(child);
			const attempt = (fn) => { try { fn(); return { threw: false }; } catch (e) { return { threw: true, message: String(e.message || e) }; } };
			return { grow: attempt(() => { child.layoutGrow = 1; }), fill: attempt(() => { child.layoutSizingHorizontal = 'FILL'; }), align: attempt(() => { child.layoutAlign = 'STRETCH'; }) };`);
		console.log(`[hallazgo trampa 13] ${JSON.stringify(out)}`);
		assert.equal(out.grow.threw, false, JSON.stringify(out));
		assert.equal(out.align.threw, false, JSON.stringify(out));
		assert.equal(
			out.fill.threw,
			true,
			`FILL no lanza en Figma: ${JSON.stringify(out)}`,
		);
	});

	it("trampa 14 (sin verificar): scrollBehavior en un hijo de un marco con auto-layout no se conserva", async () => {
		const out = await step(`${PREP}
			const parent = figma.createFrame(); page.appendChild(parent); parent.layoutMode = 'VERTICAL';
			const child = figma.createFrame(); parent.appendChild(child);
			let threw = null;
			try { child.scrollBehavior = 'STICKY_SCROLLS'; } catch (e) { threw = String(e.message || e); }
			return { threw, read: child.scrollBehavior };`);
		console.log(`[hallazgo trampa 14] ${JSON.stringify(out)}`);
		assert.notEqual(
			out.read,
			"STICKY_SCROLLS",
			`Figma SÍ conserva STICKY_SCROLLS en auto-layout (el doble no): ${JSON.stringify(out)}`,
		);
	});

	it("trampa 15 (sin verificar): layoutPositioning ABSOLUTE solo vale dentro de auto-layout y antes de x/y", async () => {
		const out = await step(`${PREP}
			const attempt = (fn) => { try { fn(); return { threw: false }; } catch (e) { return { threw: true, message: String(e.message || e) }; } };
			const plain = figma.createFrame(); page.appendChild(plain);
			const loose = figma.createFrame(); plain.appendChild(loose);
			const parent = figma.createFrame(); page.appendChild(parent); parent.layoutMode = 'HORIZONTAL';
			const child = figma.createFrame(); parent.appendChild(child);
			const outside = attempt(() => { loose.layoutPositioning = 'ABSOLUTE'; });
			const inside = attempt(() => { child.layoutPositioning = 'ABSOLUTE'; child.x = 7; child.y = 9; });
			return { outside, inside, x: child.x, y: child.y };`);
		console.log(`[hallazgo trampa 15] ${JSON.stringify(out)}`);
		assert.equal(
			out.outside.threw,
			true,
			`ABSOLUTE fuera de auto-layout no lanza en Figma (el doble sí): ${JSON.stringify(out)}`,
		);
		assert.equal(out.inside.threw, false);
		assert.deepEqual([out.x, out.y], [7, 9]);
	});

	it("trampa 16 (sin verificar): bordes por lado con INSIDE se releen igual", async () => {
		const out = await step(`${PREP}
			const f = figma.createFrame(); page.appendChild(f);
			f.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; f.strokeAlign = 'INSIDE';
			f.strokeTopWeight = 1; f.strokeRightWeight = 2; f.strokeBottomWeight = 3; f.strokeLeftWeight = 4;
			return { align: f.strokeAlign, w: [f.strokeTopWeight, f.strokeRightWeight, f.strokeBottomWeight, f.strokeLeftWeight] };`);
		console.log(`[hallazgo trampa 16] ${JSON.stringify(out)}`);
		assert.equal(out.align, "INSIDE");
		assert.deepEqual(out.w, [1, 2, 3, 4]);
	});

	it("trampa 17 (sin verificar): una variable FLOAT ligada a radio, separación y relleno pone su valor en el campo", async () => {
		const out = await step(`${PREP}
			const col = figma.variables.createVariableCollection(${JSON.stringify(COLLECTION)});
			const radius = figma.variables.createVariable('radius/x', col, 'FLOAT'); radius.setValueForMode(col.defaultModeId, 8);
			const space = figma.variables.createVariable('spacing/x', col, 'FLOAT'); space.setValueForMode(col.defaultModeId, 16);
			const f = figma.createFrame(); page.appendChild(f); f.layoutMode = 'VERTICAL';
			f.setBoundVariable('topLeftRadius', radius); f.setBoundVariable('itemSpacing', space); f.setBoundVariable('paddingTop', space);
			return { radius: f.topLeftRadius, spacing: f.itemSpacing, padding: f.paddingTop, bound: Object.keys(f.boundVariables || {}) };`);
		console.log(`[hallazgo trampa 17] ${JSON.stringify(out)}`);
		assert.equal(out.radius, 8);
		assert.equal(out.spacing, 16);
		assert.equal(out.padding, 16);
		assert.ok(
			out.bound.includes("topLeftRadius") && out.bound.includes("itemSpacing"),
		);
	});

	it("trampa 18 (sin verificar): gradientTransform de un degradado lineal y radial se relee igual", async () => {
		const out = await step(`${PREP}
			const f = figma.createFrame(); page.appendChild(f);
			const stops = [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }];
			const linear = [[0.5, 0.5, 0], [-0.5, 0.5, 0.5]];
			f.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: linear, gradientStops: stops }];
			const a = f.fills[0];
			f.fills = [{ type: 'GRADIENT_RADIAL', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: stops }];
			const b = f.fills[0];
			return { linear: a.gradientTransform, stops: a.gradientStops.length, radial: b.type };`);
		console.log(`[hallazgo trampa 18] ${JSON.stringify(out)}`);
		assert.equal(out.radial, "GRADIENT_RADIAL");
		assert.equal(out.stops, 2);
		const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
		assert.ok(
			near(out.linear[0][0], 0.5) &&
				near(out.linear[1][0], -0.5) &&
				near(out.linear[1][2], 0.5),
		);
	});

	it("trampa 19 (sin verificar): sombra con spread en un marco y estilo de efecto con setEffectStyleIdAsync", async () => {
		const out = await step(`${PREP}
			const style = figma.createEffectStyle(); style.name = 'fcc-kit-sombra';
			style.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 2 }, radius: 6, spread: -1, visible: true, blendMode: 'NORMAL' }];
			try {
				const f = figma.createFrame(); page.appendChild(f);
				f.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 2 }, radius: 6, spread: -1, visible: true, blendMode: 'NORMAL', showShadowBehindNode: false }];
				const loose = f.effects.map((e) => ({ type: e.type, spread: e.spread }));
				const g = figma.createFrame(); page.appendChild(g);
				await g.setEffectStyleIdAsync(style.id);
				return { loose, styled: g.effectStyleId === style.id, effects: g.effects.length };
			} finally { style.remove(); }`);
		console.log(`[hallazgo trampa 19] ${JSON.stringify(out)}`);
		assert.equal(out.loose[0].spread, -1);
		assert.equal(out.styled, true);
		assert.equal(out.effects, 1);
	});

	it("trampa 20 (sin verificar): los mismos bytes dan el mismo hash de imagen", async () => {
		const out = await step(`${PREP}
			const bytes = figma.base64Decode(${JSON.stringify(png(8, 8))});
			const a = figma.createImage(bytes).hash; const b = figma.createImage(bytes).hash;
			return { a, b };`);
		console.log(
			`[hallazgo trampa 20] ${JSON.stringify(out)} → ${out.a === out.b ? "MISMO hash" : "hash DISTINTO"}`,
		);
		assert.equal(out.a, out.b);
	});

	it("trampa 21 (sin verificar): createNodeFromSvg deja pinturas que se pueden repintar", async () => {
		const out = await step(`${PREP}
			const node = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M4 4L20 20" stroke="#111827" stroke-width="2"/></svg>');
			page.appendChild(node);
			const vector = node.findAllWithCriteria({ types: ['VECTOR'] })[0];
			const before = vector.strokes.map((p) => [p.type, Math.round(p.color.r * 255), Math.round(p.color.g * 255), Math.round(p.color.b * 255)]);
			vector.strokes = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
			return { before, after: vector.strokes.map((p) => [p.type, p.color.r]) };`);
		console.log(`[hallazgo trampa 21] ${JSON.stringify(out)}`);
		assert.deepEqual(out.before[0], ["SOLID", 17, 24, 39]);
		assert.deepEqual(out.after[0], ["SOLID", 1]);
	});

	it("trampa 22 (sin verificar): maxLines = 1 con textTruncation ENDING", async () => {
		const out = await step(`${PREP}
			const t = figma.createText(); page.appendChild(t); t.characters = 'un texto bastante largo para su caja';
			t.textAutoResize = 'HEIGHT'; t.resize(40, t.height); t.maxLines = 1; t.textTruncation = 'ENDING';
			return { maxLines: t.maxLines, truncation: t.textTruncation, auto: t.textAutoResize };`);
		console.log(`[hallazgo trampa 22] ${JSON.stringify(out)}`);
		assert.deepEqual(out, {
			maxLines: 1,
			truncation: "ENDING",
			auto: "HEIGHT",
		});
	});

	it("trampa 24 (sin verificar): radio 9999 en un marco", async () => {
		const out = await step(`${PREP}
			const f = figma.createFrame(); page.appendChild(f); f.resize(100, 50);
			f.cornerRadius = 9999;
			return { radius: f.cornerRadius, topLeft: f.topLeftRadius };`);
		console.log(
			`[hallazgo trampa 24] ${JSON.stringify(out)} → ${out.radius === 9999 ? "se conserva 9999" : "Figma lo recorta"}`,
		);
		assert.equal(
			out.radius,
			9999,
			`Figma no conserva 9999 (el doble sí): ${JSON.stringify(out)}`,
		);
	});

	it("kit/build-screen@1 con un plan mínimo genérico: marco, texto de dos tramos, imagen, svg e icono; repetir deja una sola página", async () => {
		const font = (weight: string) => ({
			fam: "sans-serif",
			size: 14,
			weight,
			lh: "20px",
			ls: "normal",
			tt: "none",
			td: "none",
			fs: "normal",
			ta: "left",
			ws: "normal",
			color: [17, 24, 39, 1],
		});
		const box = {
			pad: [0, 0, 0, 0],
			bw: [0, 0, 0, 0],
			rad: [0, 0, 0, 0],
			ov: "visible",
		};
		const SHA = "c".repeat(64);
		const plan = {
			contract: "screen@1",
			screen: "fcc-kit",
			title: "fcc-kit",
			variant: 0,
			props: {},
			sources: {
				capture: { path: "x", sha256: "a".repeat(64) },
				map: { path: "m", sha256: "b".repeat(64) },
			},
			target: {
				page: { name: "fcc kit pantalla", key: "fcc:screen-page:fcc-kit" },
				frame: { name: "fcc-kit marco", key: "fcc:screen:fcc-kit" },
			},
			images: { [SHA]: { asset: SHA, width: 8, height: 8, type: "png" } },
			icons: { "M0 0L4 4": "plus" },
			warnings: [],
			map: {
				tokens: {
					collections: [COLLECTION],
					classPrefixes: {
						fill: ["bg-"],
						text: ["text-"],
						stroke: ["border-"],
					},
					classToVariable: [{ from: "^(.+)$", to: "$1" }],
					fallback: { collection: COLLECTION },
					numbers: {
						radius: { prefix: "radius/" },
						spacing: { prefix: "spacing/" },
					},
				},
				fonts: {
					families: [],
					default: "Inter",
					styles: { "400": "Regular", "700": "Bold" },
					italic: { suffix: "Italic" },
				},
				icons: { pages: "fcc-kit-iconos", prefix: "icons/" },
				layers: { roles: { p: "párrafo" }, textPrefix: true },
				screen: { background: "gris" },
			},
			root: [
				{
					id: "00000001",
					path: "0",
					t: "frame",
					tag: "div",
					cls: "",
					x: 0,
					y: 0,
					w: 300,
					h: 120,
					disp: "flex",
					dir: "column",
					gap: 8,
					rgap: 8,
					jc: "normal",
					ai: "normal",
					wrap: "nowrap",
					pad: [8, 8, 8, 8],
					bg: [250, 250, 250, 1],
					bw: [1, 1, 1, 1],
					bc: [17, 24, 39, 1],
					rad: [8, 8, 8, 8],
					ov: "visible",
					font: font("400"),
					kids: [
						{
							id: "00000002",
							path: "0/0",
							t: "frame",
							tag: "p",
							disp: "block",
							x: 8,
							y: 8,
							w: 284,
							h: 20,
							...box,
							font: font("400"),
							kids: [
								{
									id: "00000003",
									path: "0/0/0",
									t: "text",
									txt: "Hola ",
									x: 8,
									y: 8,
									w: 30,
									h: 20,
									lines: 1,
									font: font("400"),
								},
								{
									id: "00000004",
									path: "0/0/1",
									t: "frame",
									tag: "strong",
									disp: "inline",
									x: 38,
									y: 8,
									w: 40,
									h: 20,
									...box,
									font: font("700"),
									kids: [
										{
											id: "00000005",
											path: "0/0/1/0",
											t: "text",
											txt: "mundo",
											x: 38,
											y: 8,
											w: 40,
											h: 20,
											lines: 1,
											font: font("700"),
										},
									],
								},
							],
						},
						{
							id: "00000006",
							path: "0/1",
							t: "img",
							ref: SHA,
							x: 8,
							y: 36,
							w: 40,
							h: 20,
							rad: [0, 0, 0, 0],
						},
						{
							id: "00000007",
							path: "0/2",
							t: "svg",
							svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L4 4" stroke="#111827"/></svg>',
							key: "M0 0L4 4",
							x: 8,
							y: 64,
							w: 24,
							h: 24,
							color: [17, 24, 39, 1],
						},
					],
				},
			],
		};
		const out = await step(
			`${PREP}
			const col = figma.variables.createVariableCollection(${JSON.stringify(COLLECTION)});
			const mk = (name, rgb) => { const v = figma.variables.createVariable(name, col, 'COLOR'); v.setValueForMode(col.defaultModeId, { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }); };
			mk('gris', [250, 250, 250]); mk('texto', [17, 24, 39]);
			const iconPage = await kit.page.ensure({ key: 'fcc:kit-test-iconos', name: 'fcc-kit-iconos' });
			const plus = figma.createComponent(); plus.name = 'icons/plus'; plus.resize(24, 24); iconPage.appendChild(plus);
			const bar = figma.createRectangle(); bar.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; plus.appendChild(bar);
			await figma.setCurrentPageAsync(page);
			const files = { plan: new TextEncoder().encode(JSON.stringify(${JSON.stringify(plan)})), ${JSON.stringify(SHA)}: figma.base64Decode(${JSON.stringify(png(8, 8))}) };
			const first = await kit.steps.buildScreen(params, files);
			const second = await kit.steps.buildScreen(params, files);
			const pages = figma.root.children.filter((p) => p.getSharedPluginData('fcc', 'key') === 'fcc:screen-page:fcc-kit');
			const marco = pages[0].children[0];
			const texts = marco.findAllWithCriteria({ types: ['TEXT'] });
			return { pages: pages.length, children: pages[0].children.length, marcoKey: marco.getSharedPluginData('fcc', 'key'), marcoName: marco.name,
				texts: texts.map((t) => t.characters), segments: texts[0] ? texts[0].getStyledTextSegments(['fontName']).map((s) => [s.characters, s.fontName.style]) : [],
				instances: marco.findAllWithCriteria({ types: ['INSTANCE'] }).length,
				imageFills: marco.findAll((n) => Array.isArray(n.fills) && n.fills.some((p) => p.type === 'IMAGE')).length,
				report: second.report, firstWarnings: (first.warnings ?? []).map((w) => w.code), removed: second.removedNodeIds ? second.removedNodeIds.length : 0 };`,
			{ screen: "fcc-kit", variant: 0 },
		);
		console.log(
			`[hallazgo build-screen] ${JSON.stringify({ pages: out.pages, texts: out.texts, segments: out.segments, instances: out.instances, imageFills: out.imageFills, warnings: out.firstWarnings, report: out.report })}`,
		);
		assert.equal(out.pages, 1, "repetir el paso deja una sola página");
		assert.equal(out.children, 1, "un solo marco en la página");
		assert.equal(out.marcoKey, "fcc:screen:fcc-kit");
		assert.equal(out.marcoName, "fcc-kit marco");
		assert.deepEqual(out.segments, [
			["Hola ", "Regular"],
			["mundo", "Bold"],
		]);
		assert.equal(
			out.instances,
			1,
			"el svg con icono del plan es una instancia de su componente",
		);
		assert.equal(out.imageFills, 1);
		assert.ok(out.removed >= 1, "el marco viejo va como quitado");
	});

	// --- F4b: reconocimiento (trampa 23 y lo que usa `recognize@1`) ---
	it("trampa 23 (sin verificar): INSTANCE_SWAP con setProperties y el id del componente cambia la instancia anidada; un id que no es de un componente lanza", async () => {
		const out = await step(`${PREP}
			const a = figma.createComponent(); a.name = 'fcc-kit-icono-a'; a.resize(10, 10); page.appendChild(a);
			const b = figma.createComponent(); b.name = 'fcc-kit-icono-b'; b.resize(10, 10); page.appendChild(b);
			const host = figma.createComponent(); host.name = 'fcc-kit-anfitrion'; page.appendChild(host);
			const nested = a.createInstance(); host.appendChild(nested);
			const key = host.addComponentProperty('Icono', 'INSTANCE_SWAP', a.id);
			nested.componentPropertyReferences = { mainComponent: key };
			const inst = host.createInstance(); page.appendChild(inst);
			const before = (await inst.findOne((n) => n.type === 'INSTANCE').getMainComponentAsync()).name;
			inst.setProperties({ [key]: b.id });
			const after = (await inst.findOne((n) => n.type === 'INSTANCE').getMainComponentAsync()).name;
			let threw = null;
			try { inst.setProperties({ [key]: 'no-es-un-id' }); } catch (e) { threw = String(e && e.message); }
			return { before, after, threw };`);
		console.log(`[hallazgo trampa 23] ${JSON.stringify(out)}`);
		assert.equal(out.before, "fcc-kit-icono-a");
		assert.equal(out.after, "fcc-kit-icono-b");
		assert.notEqual(
			out.threw,
			null,
			"un id que no es de un componente tiene que lanzar",
		);
	});

	it("trampa 25 (sin verificar): un marco pintado aparte se clona dentro del hueco (SLOT) de una instancia y puede ocupar todo el ancho", async () => {
		const out = await step(`${PREP}
			const a = figma.createComponent(); a.name = 'tipo=a'; page.appendChild(a);
			const b = figma.createComponent(); b.name = 'tipo=b'; page.appendChild(b);
			const set = figma.combineAsVariants([a, b], page); set.name = 'fcc-kit-celda';
			const slot = a.createSlot();
			const inst = a.createInstance(); page.appendChild(inst);
			const fr = figma.createFrame(); fr.name = 'contenido de la celda'; fr.resize(30, 10);
			const into = inst.findOne((n) => n.type === 'SLOT');
			const clone = fr.clone(); into.appendChild(clone); fr.remove();
			let fill = null;
			try { clone.layoutSizingHorizontal = 'FILL'; fill = clone.layoutSizingHorizontal; } catch (e) { fill = 'lanza: ' + String(e && e.message); }
			return { slots: inst.findAllWithCriteria({ types: ['SLOT'] }).length, inside: into.children.length, name: into.children[0] && into.children[0].name, fill };`);
		console.log(`[hallazgo trampa 25] ${JSON.stringify(out)}`);
		assert.equal(out.inside, 1);
		assert.equal(out.name, "contenido de la celda");
	});

	it("kit/build-screen@1 con recognize@1: un nodo de la captura sale como instancia de su set, con su texto y sin pintar su subárbol", async () => {
		const font = {
			fam: "sans-serif",
			size: 14,
			weight: "400",
			lh: "20px",
			ls: "normal",
			tt: "none",
			td: "none",
			fs: "normal",
			ta: "left",
			ws: "normal",
			color: [17, 24, 39, 1],
		};
		const box = {
			pad: [0, 0, 0, 0],
			bw: [0, 0, 0, 0],
			rad: [0, 0, 0, 0],
			ov: "visible",
		};
		const plan = {
			contract: "screen@1",
			screen: "fcc-kit",
			title: "fcc-kit",
			variant: 0,
			props: {},
			sources: {
				capture: { path: "x", sha256: "a".repeat(64) },
				map: { path: "m", sha256: "b".repeat(64) },
			},
			target: {
				page: { name: "fcc kit pantalla", key: "fcc:screen-page:fcc-kit" },
				frame: { name: "fcc-kit marco", key: "fcc:screen:fcc-kit" },
			},
			images: {},
			icons: {},
			warnings: [],
			rules: ["Boton"],
			map: {
				tokens: {
					collections: [COLLECTION],
					classPrefixes: {
						fill: ["bg-"],
						text: ["text-"],
						stroke: ["border-"],
					},
					classToVariable: [{ from: "^(.+)$", to: "$1" }],
					fallback: { collection: COLLECTION },
				},
				fonts: {
					families: [],
					default: "Inter",
					styles: { "400": "Regular" },
					italic: { suffix: "Italic" },
				},
				icons: { pages: "fcc-kit-iconos", prefix: "icons/" },
				layers: { roles: {}, textPrefix: true },
			},
			root: [
				{
					id: "00000001",
					path: "0",
					t: "frame",
					tag: "div",
					cls: "",
					x: 0,
					y: 0,
					w: 300,
					h: 60,
					disp: "flex",
					dir: "row",
					gap: 0,
					rgap: 0,
					jc: "normal",
					ai: "normal",
					wrap: "nowrap",
					...box,
					font,
					kids: [
						{
							id: "00000002",
							path: "0/0",
							t: "frame",
							tag: "button",
							cls: "boton",
							disp: "block",
							x: 0,
							y: 0,
							w: 120,
							h: 32,
							...box,
							font,
							kids: [
								{
									id: "00000003",
									path: "0/0/0",
									t: "text",
									txt: "Guardar",
									x: 0,
									y: 0,
									w: 60,
									h: 20,
									lines: 1,
									font,
								},
							],
						},
					],
				},
			],
		};
		const recognize = `{ contract: 'recognize@1', rules: { 'fcc-kit-boton': {
			match: (n, cls) => n.tag === 'button' && cls.has('boton'),
			props: (n, cls, ctx) => ({ variant: { tamano: 'md' }, set: { etiqueta: ctx.allText(n)[0] } }) } } }`.replace(
			"'fcc-kit-boton'",
			"'Boton'",
		);
		const out = await step(
			`${PREP}
			const col = figma.variables.createVariableCollection(${JSON.stringify(COLLECTION)});
			const v = figma.variables.createVariable('gris', col, 'COLOR'); v.setValueForMode(col.defaultModeId, { r: 0.9, g: 0.9, b: 0.9 });
			const iconPage = await kit.page.ensure({ key: 'fcc:kit-test-iconos', name: 'fcc-kit-iconos' });
			const lib = await kit.page.ensure({ key: 'fcc:kit-test-componentes', name: 'fcc-kit-componentes' });
			const comp = figma.createComponent(); comp.name = 'tamano=md'; lib.appendChild(comp); comp.resize(100, 32);
			await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
			const label = figma.createText(); label.characters = 'x'; comp.appendChild(label);
			const set = figma.combineAsVariants([comp], lib); set.name = 'Boton';
			const key = set.addComponentProperty('etiqueta', 'TEXT', 'x');
			for (const c of set.children) for (const t of c.findAllWithCriteria({ types: ['TEXT'] })) t.componentPropertyReferences = { characters: key };
			await figma.setCurrentPageAsync(page);
			const files = { plan: new TextEncoder().encode(JSON.stringify(${JSON.stringify(plan)})) };
			const recognize = ${recognize};
			const result = await kit.steps.buildScreen(params, files, recognize);
			const marco = figma.root.children.find((p) => p.getSharedPluginData('fcc', 'key') === 'fcc:screen-page:fcc-kit').children[0];
			const inst = marco.findAllWithCriteria({ types: ['INSTANCE'] });
			const names = [];
			for (const i of inst) { const m = await i.getMainComponentAsync(); names.push(m.parent && m.parent.name); }
			return { instances: inst.length, sets: names, texts: marco.findAllWithCriteria({ types: ['TEXT'] }).map((t) => t.characters),
				matches: result.report.matches, warnings: (result.warnings || []).map((w) => w.code) };`,
			{ screen: "fcc-kit", variant: 0 },
		);
		console.log(`[hallazgo recognize] ${JSON.stringify(out)}`);
		assert.equal(out.instances, 1);
		assert.deepEqual(out.sets, ["Boton"]);
		assert.deepEqual(out.texts, ["Guardar"]);
		assert.equal(out.matches[0].by, "rule:Boton");
	});

	// --- Hojas de componentes: las trampas H1, H7 a H10 y H12 a H16 de la primera mitad y el
	// paso `kit/build-component@1` sobre una hoja mínima. Cada caso escribe `[hallazgo trampa Hn]` con lo que hizo Figma; si Figma hace
	// otra cosa que el doble, el doble cambia en el mismo commit que el hallazgo. Todo cuelga de la página de pruebas. ---
	it("trampa H1 (sin verificar): createComponentFromNode sobre un marco con auto-layout conserva la disposición y devuelve un nodo que se relee", async () => {
		const out = await step(`${PREP}
			const f = figma.createFrame(); page.appendChild(f);
			f.layoutMode = 'HORIZONTAL'; f.itemSpacing = 7; f.paddingLeft = 3; f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
			const t = figma.createText(); t.characters = 'x'; f.appendChild(t);
			const oldId = f.id;
			const comp = figma.createComponentFromNode(f);
			const again = await figma.getNodeByIdAsync(comp.id);
			return { sameId: comp.id === oldId, type: comp.type, layoutMode: comp.layoutMode, itemSpacing: comp.itemSpacing, paddingLeft: comp.paddingLeft, kids: comp.children.length, reread: again !== null && again.id === comp.id };`);
		console.log(`[hallazgo trampa H1] ${JSON.stringify(out)}`);
		assert.equal(out.type, "COMPONENT");
		assert.deepEqual(
			[out.layoutMode, out.itemSpacing, out.paddingLeft, out.kids],
			["HORIZONTAL", 7, 3, 1],
		);
		assert.equal(out.reread, true);
	});

	it("trampa H7 (sin verificar): combineAsVariants puede cambiar los ids de las variantes; el kit las relee del set por su nombre", async () => {
		const out = await step(`${PREP}
			const mk = (name, w) => { const f = figma.createFrame(); page.appendChild(f); f.resize(w, 30); const c = figma.createComponentFromNode(f); c.name = name; return c; };
			const a = mk('v=a', 80); const b = mk('v=b', 120);
			const ids = [a.id, b.id];
			const host = figma.createFrame(); page.appendChild(host);
			const set = figma.combineAsVariants([a, b], host);
			const after = set.children.map((c) => ({ id: c.id, name: c.name, props: c.variantProperties, w: c.width, x: c.x }));
			return { ids, after, setW: set.width, setH: set.height };`);
		console.log(`[hallazgo trampa H7] ${JSON.stringify(out)}`);
		assert.deepEqual(out.after.map((c: { name: string }) => c.name).sort(), [
			"v=a",
			"v=b",
		]);
		assert.deepEqual(
			out.after
				.map((c: { props: unknown }) => c.props)
				.sort((x: { v: string }, y: { v: string }) => x.v.localeCompare(y.v)),
			[{ v: "a" }, { v: "b" }],
		);
	});

	it("trampa H8 (sin verificar): componentPropertyReferences en un texto DENTRO de una instancia anidada lanza", async () => {
		const out = await step(`${PREP}
			const inner = figma.createComponent(); inner.name = 'fcc-kit-interno'; page.appendChild(inner);
			const label = figma.createText(); label.characters = 'x'; inner.appendChild(label);
			const host = figma.createComponent(); host.name = 'v=a'; page.appendChild(host);
			const nested = inner.createInstance(); host.appendChild(nested);
			const hostB = figma.createComponent(); hostB.name = 'v=b'; page.appendChild(hostB);
			const holder = figma.createFrame(); page.appendChild(holder);
			const set = figma.combineAsVariants([host, hostB], holder);
			const key = set.addComponentProperty('etiqueta', 'TEXT', 'x');
			const insideText = set.children[0].findOne((n) => n.type === 'INSTANCE').findOne((n) => n.type === 'TEXT');
			let threw = null;
			try { insideText.componentPropertyReferences = { characters: key }; } catch (e) { threw = String(e && e.message); }
			return { threw };`);
		console.log(`[hallazgo trampa H8] ${JSON.stringify(out)}`);
		assert.notEqual(
			out.threw,
			null,
			"una capa dentro de una instancia no admite referencias",
		);
	});

	it("trampa H9 (sin verificar): INSTANCE_SWAP con un id que no es de un componente lanza al crearlo, y preferredValues de un componente local se acepta", async () => {
		const out = await step(`${PREP}
			const icon = figma.createComponent(); icon.name = 'fcc-kit-icono'; icon.resize(10, 10); page.appendChild(icon);
			const mk = (name) => { const c = figma.createComponent(); c.name = name; page.appendChild(c); return c; };
			const a = mk('v=a'); const b = mk('v=b');
			const holder = figma.createFrame(); page.appendChild(holder);
			const set = figma.combineAsVariants([a, b], holder);
			const rect = figma.createRectangle(); page.appendChild(rect);
			let threw = null;
			try { set.addComponentProperty('Icono malo', 'INSTANCE_SWAP', rect.id); } catch (e) { threw = String(e && e.message); }
			let ok = null; let preferred = null; let acceptedKeys = null;
			try {
				const key = set.addComponentProperty('Icono', 'INSTANCE_SWAP', icon.id, { preferredValues: [{ type: 'COMPONENT', key: icon.key }] });
				const def = set.componentPropertyDefinitions[key];
				ok = def.type; preferred = def.preferredValues;
			} catch (e) { acceptedKeys = String(e && e.message); }
			return { threw, ok, preferred, acceptedKeys };`);
		console.log(`[hallazgo trampa H9] ${JSON.stringify(out)}`);
		assert.notEqual(
			out.threw,
			null,
			"un id que no es de un componente tiene que lanzar",
		);
		assert.equal(out.ok, "INSTANCE_SWAP", String(out.acceptedKeys));
		assert.equal(out.preferred.length, 1);
	});

	it("trampa H10 (medida): isExposedInstance solo se acepta en una instancia con instancias anidadas expuestas o con hijos con referencias de propiedad", async () => {
		const out = await step(`${PREP}
			const inner = figma.createComponent(); inner.name = 'fcc-kit-bandera'; inner.resize(8, 8); page.appendChild(inner);
			const mk = (name) => { const c = figma.createComponent(); c.name = name; page.appendChild(c); c.appendChild(inner.createInstance()); return c; };
			const a = mk('v=a'); const b = mk('v=b');
			const holder = figma.createFrame(); page.appendChild(holder);
			const set = figma.combineAsVariants([a, b], holder);
			let threw = null;
			try { set.children[0].findOne((n) => n.type === 'INSTANCE').isExposedInstance = true; } catch (e) { threw = String(e && e.message); }
			return { threw };`);
		console.log(`[hallazgo trampa H10] ${JSON.stringify(out)}`);
		assert.match(
			String(out.threw),
			/Can only expose instances that have exposed nested instances or children with component property references/,
		);
	});

	it("trampa H12 (sin verificar): una propiedad SLOT se lee sin defaultValue", async () => {
		const out = await step(`${PREP}
			const mk = (name) => { const c = figma.createComponent(); c.name = name; page.appendChild(c); return c; };
			const a = mk('v=a'); const b = mk('v=b');
			const holder = figma.createFrame(); page.appendChild(holder);
			const set = figma.combineAsVariants([a, b], holder);
			set.children[0].createSlot();
			const slot = Object.values(set.componentPropertyDefinitions).find((d) => d.type === 'SLOT');
			return { found: slot !== undefined, hasDefault: slot !== undefined && 'defaultValue' in slot };`);
		console.log(`[hallazgo trampa H12] ${JSON.stringify(out)}`);
		assert.equal(out.found, true);
		assert.equal(
			out.hasDefault,
			false,
			"una propiedad SLOT no trae defaultValue",
		);
	});

	it("trampa H13 (sin verificar): resizeWithoutConstraints de un set y las posiciones de sus variantes se releen; el set no se reajusta solo", async () => {
		const out = await step(`${PREP}
			const mk = (name, w) => { const f = figma.createFrame(); page.appendChild(f); f.resize(w, 30); const c = figma.createComponentFromNode(f); c.name = name; return c; };
			const a = mk('v=a', 80); const b = mk('v=b', 120);
			const holder = figma.createFrame(); page.appendChild(holder);
			const set = figma.combineAsVariants([a, b], holder);
			set.children[0].x = 40; set.children[0].y = 40; set.children[1].x = 172; set.children[1].y = 40;
			set.resizeWithoutConstraints(400, 150);
			const afterResize = [set.width, set.height, set.children[0].x, set.children[0].y, set.children[1].x];
			set.children[1].resize(500, 60);
			return { afterResize, setWAfterGrow: set.width };`);
		console.log(`[hallazgo trampa H13] ${JSON.stringify(out)}`);
		assert.deepEqual(
			out.afterResize.map((n: number) => Math.round(n)),
			[400, 150, 40, 40, 172],
		);
		assert.equal(
			Math.round(out.setWAfterGrow),
			400,
			"el set no se reajusta solo al cambiar una variante",
		);
	});

	it("trampa H14 (sin verificar): nombres de variante con espacios y valores con «·» se leen igual en variantProperties", async () => {
		const out = await step(`${PREP}
			const mk = (name) => { const c = figma.createComponent(); c.name = name; page.appendChild(c); return c; };
			const a = mk('icon only=false, estado=a · b'); const b = mk('icon only=true, estado=a · b');
			const holder = figma.createFrame(); page.appendChild(holder);
			const set = figma.combineAsVariants([a, b], holder);
			return { names: set.children.map((c) => c.name), props: set.children.map((c) => c.variantProperties) };`);
		console.log(`[hallazgo trampa H14] ${JSON.stringify(out)}`);
		assert.deepEqual(out.names.sort(), [
			"icon only=false, estado=a · b",
			"icon only=true, estado=a · b",
		]);
		assert.deepEqual(
			out.props
				.map((p: Record<string, string>) => [p["icon only"], p["estado"]])
				.sort(),
			[
				["false", "a · b"],
				["true", "a · b"],
			],
		);
	});

	it("trampa H15 (sin verificar): la descripción de un set con saltos de línea se relee igual", async () => {
		const out = await step(`${PREP}
			const mk = (name) => { const c = figma.createComponent(); c.name = name; page.appendChild(c); return c; };
			const holder = figma.createFrame(); page.appendChild(holder);
			const set = figma.combineAsVariants([mk('v=a'), mk('v=b')], holder);
			const text = 'FALLO: x\\n\\nDescripción\\n<ui-button>';
			set.description = text;
			return { same: set.description === text, got: set.description };`);
		console.log(`[hallazgo trampa H15] ${JSON.stringify(out)}`);
		assert.equal(out.same, true);
	});

	it("trampa H16 (sin verificar): figma.root.insertChild de una página que ya existe la cambia de sitio sin cambiar su id", async () => {
		const out = await step(`
			const a = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY)}, name: ${JSON.stringify(PAGE_NAME)} });
			const b = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY_2)}, name: ${JSON.stringify(PAGE_NAME_2)} });
			const id = a.id;
			figma.root.insertChild(figma.root.children.length - 1, a);
			const pages = figma.root.children;
			return { sameId: a.id === id, last: pages[pages.length - 1].id === a.id, penultimate: pages[pages.length - 2].id === a.id, count: pages.filter((p) => p.id === id).length, other: b.id !== id };`);
		console.log(`[hallazgo trampa H16] ${JSON.stringify(out)}`);
		assert.equal(out.sameId, true);
		assert.equal(out.count, 1, "la página no se duplica al moverla");
	});

	// --- Hojas de componentes, segunda mitad: rehacer sobre el set que ya existe. Cada caso
	// escribe `[hallazgo trampa Hn]` con lo que hizo Figma; el doble reproduce lo medido (server/test/kits/figma/fake-figma.ts). ---
	const SET_WITH_TEXT = `
		await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
		const mkVariant = (name) => {
			const c = figma.createComponent(); c.name = name; page.appendChild(c); c.layoutMode = 'VERTICAL';
			const t = figma.createText(); t.characters = 'Etiqueta'; t.name = 'etiqueta'; c.appendChild(t);
			const f = figma.createText(); f.characters = 'fijo'; f.name = 'fijo'; c.appendChild(f);
			return c;
		};
		const holder = figma.createFrame(); page.appendChild(holder);
		const set = figma.combineAsVariants([mkVariant('v=a'), mkVariant('v=b')], holder);
		const key = set.addComponentProperty('etiqueta', 'TEXT', 'Etiqueta');
		for (const c of set.children) c.findOne((n) => n.name === 'etiqueta').componentPropertyReferences = { characters: key };
		const other = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY_2)}, name: ${JSON.stringify(PAGE_NAME_2)} });
		for (const c of [...other.children]) c.remove();`;

	it("trampa H2 (medida): vaciar una variante y rellenarla conserva sus instancias; el cambio por propiedad se queda y el directo en una subcapa se pierde", async () => {
		const out = await step(`${PREP}${SET_WITH_TEXT}
			const target = set.children[0];
			const inst = target.createInstance(); other.appendChild(inst);
			inst.setProperties({ [key]: 'Por propiedad' });
			inst.findOne((n) => n.name === 'fijo').characters = 'directo';
			const read = async () => ({
				main: (await inst.getMainComponentAsync()).id,
				prop: inst.componentProperties[key] ? inst.componentProperties[key].value : null,
				etiqueta: inst.findOne((n) => n.name === 'etiqueta').characters,
				fijo: inst.findOne((n) => n.name === 'fijo').characters,
				overrides: inst.overrides.map((o) => ({ id: o.id, fields: o.overriddenFields })), instId: inst.id,
			});
			const before = await read();
			const donor = figma.createComponent(); donor.name = 'donante'; page.appendChild(donor); donor.layoutMode = 'VERTICAL';
			const t = figma.createText(); t.characters = 'Etiqueta nueva'; t.name = 'etiqueta'; donor.appendChild(t);
			const f = figma.createText(); f.characters = 'fijo nuevo'; f.name = 'fijo'; donor.appendChild(f);
			for (const c of [...target.children]) c.remove();
			for (const c of [...donor.children]) target.appendChild(c);
			donor.remove();
			target.findOne((n) => n.name === 'etiqueta').componentPropertyReferences = { characters: key };
			const after = await read();
			return { targetId: target.id, before, after };`);
		console.log(`[hallazgo trampa H2] ${JSON.stringify(out)}`);
		assert.equal(
			out.after.main,
			out.targetId,
			"la instancia sigue apuntando al mismo componente",
		);
		assert.equal(
			out.after.prop,
			"Por propiedad",
			"el valor puesto por propiedad se conserva",
		);
	});

	it("trampa H3 (medida): editComponentProperty conserva la clave nombre#id y no pisa el valor que una instancia ya puso", async () => {
		const out = await step(`${PREP}${SET_WITH_TEXT}
			const inst = set.children[0].createInstance(); other.appendChild(inst);
			inst.setProperties({ [key]: 'Por propiedad' });
			const bool = set.addComponentProperty('Mostrar', 'BOOLEAN', true);
			const returned = set.editComponentProperty(key, { defaultValue: 'Otro defecto' });
			const boolReturned = set.editComponentProperty(bool, { defaultValue: false });
			const keys = Object.keys(set.componentPropertyDefinitions);
			return { key, returned, boolKey: bool, boolReturned, keys, def: set.componentPropertyDefinitions[returned], boolDef: set.componentPropertyDefinitions[boolReturned],
				instanceValue: inst.componentProperties[returned] ? inst.componentProperties[returned].value : null, instanceKeys: Object.keys(inst.componentProperties),
				ref: set.children[0].findOne((n) => n.name === 'etiqueta').componentPropertyReferences };`);
		console.log(`[hallazgo trampa H3] ${JSON.stringify(out)}`);
		assert.equal(out.returned, out.key, "la clave se conserva");
		assert.equal(out.def.defaultValue, "Otro defecto");
		assert.equal(out.boolDef.defaultValue, false);
		assert.equal(
			out.instanceValue,
			"Por propiedad",
			"el valor de la instancia no se pisa",
		);
	});

	it("trampa H4 (medida): addComponentProperty con un nombre que ya existe lanza o crea otra clave", async () => {
		const out = await step(`${PREP}${SET_WITH_TEXT}
			let threw = null; let again = null;
			try { again = set.addComponentProperty('etiqueta', 'TEXT', 'x'); } catch (e) { threw = String(e && e.message); }
			return { key, threw, again, keys: Object.keys(set.componentPropertyDefinitions) };`);
		console.log(`[hallazgo trampa H4] ${JSON.stringify(out)}`);
		assert.ok(out.threw !== null || out.again !== out.key);
	});

	it("trampa H5 (medida): una propiedad sin capas que la usen se queda en el set", async () => {
		const out = await step(`${PREP}${SET_WITH_TEXT}
			for (const c of set.children) for (const n of [...c.children]) n.remove();
			return { keys: Object.keys(set.componentPropertyDefinitions) };`);
		console.log(`[hallazgo trampa H5] ${JSON.stringify(out)}`);
		assert.ok(out.keys.some((k: string) => k.startsWith("etiqueta#")));
	});

	it("trampa H6 (medida): set.appendChild de un componente añade una variante y lee sus props del nombre", async () => {
		const out = await step(`${PREP}${SET_WITH_TEXT}
			const c = figma.createComponent(); c.name = 'v=c'; page.appendChild(c);
			const t = figma.createText(); t.characters = 'Etiqueta'; t.name = 'etiqueta'; c.appendChild(t);
			set.appendChild(c);
			const back = set.children.find((x) => x.name === 'v=c');
			return { count: set.children.length, props: back ? back.variantProperties : null, parent: back ? back.parent.id === set.id : false,
				options: set.componentPropertyDefinitions.v ? set.componentPropertyDefinitions.v.variantOptions : null, x: back && back.x, y: back && back.y };`);
		console.log(`[hallazgo trampa H6] ${JSON.stringify(out)}`);
		assert.equal(out.count, 3);
		assert.deepEqual(out.props, { v: "c" });
	});

	it("trampa H11 (medida): un hueco repintado con createSlot() y kit.slot.share conserva su clave y lo que las instancias metieron dentro", async () => {
		const out = await step(`${PREP}${SET_WITH_TEXT}
			const variants = set.children;
			for (const v of variants) v.findOne((n) => n.name === 'fijo').remove();
			const common = kit.slot.share(variants, 'Hueco');
			const inst = variants[0].createInstance(); other.appendChild(inst);
			const slotIn = inst.findOne((n) => n.type === 'SLOT');
			const content = figma.createRectangle(); content.name = 'contenido'; slotIn.appendChild(content);
			const read = () => { const s = inst.findOne((n) => n.type === 'SLOT'); return { slot: s !== null, kids: s ? s.children.map((c) => c.name) : null }; };
			const before = read();
			for (const v of variants) v.findOne((n) => n.type === 'SLOT').remove();
			const again = kit.slot.share(variants, 'Hueco');
			const after = read();
			const slotDefs = Object.keys(set.componentPropertyDefinitions).filter((k) => set.componentPropertyDefinitions[k].type === 'SLOT');
			return { common, again, sameKey: common === again, before, after, slotDefs };`);
		console.log(`[hallazgo trampa H11] ${JSON.stringify(out)}`);
		assert.equal(out.sameKey, true);
	});

	// La hoja mínima genérica (dos variantes, un texto, un booleano y un icono; con `withSlot`, también una capa `hueco`): el plan
	// component@1 que usan el caso de la página aparte y el de rehacer sobre el set que ya existe
	const miniSheetPlan = (withSlot = false) => {
		const font = {
			fam: "sans-serif",
			size: 14,
			weight: "400",
			lh: "20px",
			ls: "normal",
			tt: "none",
			td: "none",
			fs: "normal",
			ta: "left",
			ws: "normal",
			color: [17, 24, 39, 1],
		};
		const box = {
			pad: [0, 0, 0, 0],
			bw: [0, 0, 0, 0],
			rad: [0, 0, 0, 0],
			ov: "visible",
		};
		const root = (w: number) => ({
			id: "00000001",
			path: "0",
			t: "frame",
			tag: "button",
			cls: "boton",
			x: 0,
			y: 0,
			w,
			h: 32,
			disp: "flex",
			dir: "row",
			gap: 4,
			rgap: 4,
			jc: "normal",
			ai: "center",
			wrap: "nowrap",
			...box,
			font,
			kids: [
				...(withSlot
					? [
							{
								id: "00000005",
								path: "0/3",
								t: "frame",
								tag: "div",
								cls: "hueco",
								disp: "block",
								x: 0,
								y: 0,
								w: 40,
								h: 20,
								...box,
								font,
								kids: [
									{
										id: "00000006",
										path: "0/3/0",
										t: "text",
										txt: "Contenido",
										x: 0,
										y: 0,
										w: 40,
										h: 20,
										lines: 1,
										font,
									},
								],
							},
						]
					: []),
				{
					id: "00000002",
					path: "0/0",
					t: "text",
					txt: "Guardar",
					x: 0,
					y: 0,
					w: 60,
					h: 20,
					lines: 1,
					font,
				},
				{
					id: "00000003",
					path: "0/1",
					t: "frame",
					tag: "span",
					cls: "punto",
					disp: "block",
					x: 0,
					y: 0,
					w: 8,
					h: 8,
					...box,
					font,
					kids: [],
				},
				{
					id: "00000004",
					path: "0/2",
					t: "svg",
					svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L4 4" stroke="#111827"/></svg>',
					key: "M0 0L4 4",
					x: 0,
					y: 0,
					w: 16,
					h: 16,
					color: null,
				},
			],
		});
		const plan = {
			contract: "component@1",
			sheet: {
				key: "fcc-kit",
				screen: "cmp-fcc-kit",
				title: "fcc-kit-hoja",
				page: { name: "fcc kit hoja" },
				description: "Descripción\nsegunda línea",
				tag: "<c-fcc-kit>",
				names: [{ classes: "punto", name: "punto" }],
				texts: [{ name: "etiqueta", match: "Guardar" }],
				booleans: [{ name: "Mostrar punto", layer: "punto", on: true }],
				icons: [
					{ icon: "plus", boolean: "Mostrar icono", swap: "Icono", on: true },
				],
			},
			style: {
				header: { fill: "gris", text: "texto" },
				card: { fill: "gris" },
				texts: {
					description: "texto",
					bug: "texto",
					tag: "texto",
					rowLabel: "texto",
					colLabel: "texto",
				},
				matrix: { stroke: "texto" },
			},
			sources: {
				capture: { path: "x", sha256: "a".repeat(64) },
				sheets: { path: "s", sha256: "c".repeat(64) },
				map: { path: "m", sha256: "b".repeat(64) },
			},
			target: {
				page: {
					name: "fcc · hoja · fcc-kit",
					key: "fcc:sheet-scratch:fcc-kit",
				},
				set: { name: "fcc-kit-hoja", key: "fcc:sheet:fcc-kit" },
			},
			variants: [
				{ props: { tamano: "sm" }, root: [root(120)] },
				{ props: { tamano: "lg" }, root: [root(160)] },
			],
			images: {},
			icons: { "M0 0L4 4": "plus" },
			rules: [],
			matrix: {
				rows: ["tamano=sm", "tamano=lg"],
				columns: [],
				cells: [[0], [1]],
			},
			warnings: [],
			map: {
				tokens: {
					collections: [SHEET_COLLECTION],
					classPrefixes: {
						fill: ["bg-"],
						text: ["text-"],
						stroke: ["border-"],
					},
					classToVariable: [{ from: "^(.+)$", to: "$1" }],
					fallback: { collection: SHEET_COLLECTION },
				},
				fonts: {
					families: [],
					default: "Inter",
					styles: { "400": "Regular", "500": "Medium", "600": "Semi Bold" },
					italic: { suffix: "Italic" },
				},
				icons: { pages: "fcc-kit-iconos", prefix: "icons/" },
				layers: { roles: {}, textPrefix: true },
			},
		};
		return plan;
	};

	it("kit/build-component@1 con una hoja mínima genérica: dos variantes, un texto, un booleano y un icono; en la página aparte; repetir deja una sola", async () => {
		const plan = miniSheetPlan();
		const out = await step(
			`${PREP}
			for (const style of ['Medium', 'Semi Bold']) await figma.loadFontAsync({ family: 'Inter', style });
			const col = figma.variables.createVariableCollection(${JSON.stringify(SHEET_COLLECTION)});
			const mk = (name, rgb) => { const v = figma.variables.createVariable(name, col, 'COLOR'); v.setValueForMode(col.defaultModeId, { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }); };
			mk('gris', [250, 250, 250]); mk('texto', [17, 24, 39]);
			const iconPage = await kit.page.ensure({ key: 'fcc:kit-test-iconos', name: 'fcc-kit-iconos' });
			const plus = figma.createComponent(); plus.name = 'icons/plus'; plus.resize(24, 24); iconPage.appendChild(plus);
			const bar = figma.createRectangle(); bar.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; plus.appendChild(bar);
			await figma.setCurrentPageAsync(page);
			const files = { plan: new TextEncoder().encode(JSON.stringify(${JSON.stringify(plan)})) };
			const first = await kit.steps.buildComponent(params, files);
			const second = await kit.steps.buildComponent(params, files);
			const pages = figma.root.children.filter((p) => p.getSharedPluginData('fcc', 'key') === 'fcc:sheet-scratch:fcc-kit');
			const sets = pages[0].findAllWithCriteria({ types: ['COMPONENT_SET'] });
			const set = sets[0];
			const names = Object.keys(set.componentPropertyDefinitions).map((k) => k.split('#')[0]).sort();
			return { pages: pages.length, sets: sets.length, setKey: set.getSharedPluginData('fcc', 'key'), variants: set.children.map((c) => c.name).sort(), names,
				description: set.description, dash: set.dashPattern, report: second.report, firstWarnings: (first.warnings ?? []).map((w) => w.code), removed: second.removedNodeIds ? second.removedNodeIds.length : 0 };`,
			{ sheet: "fcc-kit", scratch: true },
		);
		console.log(
			`[hallazgo build-component] ${JSON.stringify({ pages: out.pages, sets: out.sets, variants: out.variants, names: out.names, warnings: out.firstWarnings, report: out.report })}`,
		);
		assert.equal(out.pages, 1, "repetir el paso deja una sola página aparte");
		assert.equal(out.sets, 1);
		assert.equal(out.setKey, "fcc:sheet:fcc-kit");
		assert.deepEqual(out.variants, ["tamano=lg", "tamano=sm"]);
		assert.deepEqual(
			out.names,
			["Icono", "Mostrar icono", "Mostrar punto", "etiqueta", "tamano"].sort(),
		);
		assert.equal(out.description, "Descripción\nsegunda línea\n<c-fcc-kit>");
		assert.deepEqual(out.dash, [6, 4]);
		assert.ok(out.removed >= 1, "lo viejo de la página aparte va como quitado");
	});

	it("kit/build-component@1 rehace una hoja que ya existe: mismo set, mismas variantes y claves de propiedad, la instancia de fuera conserva su componente, su texto por propiedad y lo que metió en el hueco", async () => {
		const base = miniSheetPlan(true) as Record<string, any>;
		const planB = {
			...base,
			sheet: {
				...base["sheet"],
				key: "fcc-kit-b",
				title: "fcc-kit-hoja-b",
				page: { name: "fcc kit hoja b" },
				names: [...base["sheet"].names, { classes: "hueco", name: "hueco" }],
				slots: [{ name: "Hueco", layer: "hueco", boolean: "Mostrar hueco" }],
			},
			target: {
				page: { name: "fcc kit hoja b", key: "fcc:sheet-page:fcc-kit-b" },
				set: { name: "fcc-kit-hoja-b", key: "fcc:sheet:fcc-kit-b" },
			},
		};
		const planKeep = {
			...planB,
			sheet: { ...planB.sheet, keep: ["Mostrar a mano"] },
		};
		const out = await step(
			`${PREP}
			for (const style of ['Medium', 'Semi Bold']) await figma.loadFontAsync({ family: 'Inter', style });
			for (const c of await figma.variables.getLocalVariableCollectionsAsync()) if (c.name === ${JSON.stringify(SHEET_COLLECTION)}) c.remove();
			const col = figma.variables.createVariableCollection(${JSON.stringify(SHEET_COLLECTION)});
			const mk = (name, rgb) => { const v = figma.variables.createVariable(name, col, 'COLOR'); v.setValueForMode(col.defaultModeId, { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }); };
			mk('gris', [250, 250, 250]); mk('texto', [17, 24, 39]);
			const iconPage = await kit.page.ensure({ key: 'fcc:kit-test-iconos', name: 'fcc-kit-iconos' });
			for (const c of [...iconPage.children]) c.remove();
			const plus = figma.createComponent(); plus.name = 'icons/plus'; plus.resize(24, 24); iconPage.appendChild(plus);
			const bar = figma.createRectangle(); bar.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; plus.appendChild(bar);
			const other = await kit.page.ensure({ key: ${JSON.stringify(PAGE_KEY_2)}, name: ${JSON.stringify(PAGE_NAME_2)} });
			for (const c of [...other.children]) c.remove();
			await figma.setCurrentPageAsync(page);
			const enc = (plan) => ({ plan: new TextEncoder().encode(JSON.stringify(plan)) });
			const stepParams = { sheet: 'fcc-kit-b', scratch: false };
			const first = await kit.steps.buildComponent(stepParams, enc(${JSON.stringify(planB)}));
			const sheetPage = () => figma.root.children.find((p) => p.getSharedPluginData('fcc', 'key') === 'fcc:sheet-page:fcc-kit-b');
			const setNow = () => sheetPage().findAllWithCriteria({ types: ['COMPONENT_SET'] })[0];
			const snapshot = (set) => ({ id: set.id, variants: set.children.map((c) => c.id + ':' + c.name), keys: Object.keys(set.componentPropertyDefinitions).sort() });
			const set = setNow();
			const before = snapshot(set);
			const slotInfo = (v) => { const s = v.findAllWithCriteria({ types: ['SLOT'] })[0]; return s ? { name: s.name, refs: s.componentPropertyReferences, index: s.parent.children.indexOf(s), parent: s.parent.name, kids: s.children.map((k) => k.name + ':' + k.type), w: s.width, h: s.height, layoutMode: s.layoutMode } : null; };
			const slotBefore = slotInfo(set.children[0]);
			const small = set.children.find((c) => c.name === 'tamano=sm');
			const inst = small.createInstance(); other.appendChild(inst);
			const etiquetaKey = Object.keys(set.componentPropertyDefinitions).find((k) => k.startsWith('etiqueta#'));
			inst.setProperties({ [etiquetaKey]: 'Cambiado' });
			const slotIn = inst.findOne((n) => n.type === 'SLOT');
			const mine = figma.createRectangle(); mine.name = 'mio'; if (slotIn) slotIn.appendChild(mine);
			const hand = set.addComponentProperty('Mostrar a mano', 'BOOLEAN', true);
			const instRead = async () => { const s = inst.findOne((n) => n.type === 'SLOT'); const t = inst.findAllWithCriteria({ types: ['TEXT'] }).map((x) => x.characters); return { main: (await inst.getMainComponentAsync()).id, etiqueta: inst.componentProperties[etiquetaKey] && inst.componentProperties[etiquetaKey].value, texts: t, slotKids: s ? s.children.map((k) => k.name) : null, overrides: inst.overrides.length }; };
			const instBefore = await instRead();
			const pageKidsBefore = sheetPage().children.map((c) => c.id);
			let refused = null;
			try { await kit.steps.buildComponent(stepParams, enc(${JSON.stringify(planB)})); } catch (e) { refused = String(e && e.message); }
			const pageKidsRefused = sheetPage().children.map((c) => c.id);
			const second = await kit.steps.buildComponent(stepParams, enc(${JSON.stringify(planKeep)}));
			const after = snapshot(setNow());
			const instAfter = await instRead();
			const third = await kit.steps.buildComponent(stepParams, enc(${JSON.stringify(planKeep)}));
			const afterThird = snapshot(setNow());
			return { before, after, afterThird, hand, slotBefore, slotAfter: slotInfo(setNow().children[0]), instBefore, instAfter, refused, untouchedWhenRefused: JSON.stringify(pageKidsBefore) === JSON.stringify(pageKidsRefused),
				headers: sheetPage().children.filter((c) => c.name === 'Header').length, pages: figma.root.children.filter((p) => p.getSharedPluginData('fcc', 'key') === 'fcc:sheet-page:fcc-kit-b').length, sets: sheetPage().findAllWithCriteria({ types: ['COMPONENT_SET'] }).length,
				firstWarnings: (first.warnings ?? []).map((w) => w.code), secondWarnings: (second.warnings ?? []).map((w) => w.code + ': ' + w.message), report: second.report, thirdReport: third.report };`,
		);
		console.log(`[hallazgo build-component rehecho] ${JSON.stringify(out)}`);
		assert.match(String(out.refused), /SHEET_HAND_EDITS/);
		assert.equal(out.untouchedWhenRefused, true, "negarse no escribe nada");
		assert.equal(out.after.id, out.before.id, "mismo set");
		assert.deepEqual(
			out.after.variants,
			out.before.variants,
			"mismas variantes, mismos ids",
		);
		assert.deepEqual(
			out.after.keys,
			[...out.before.keys, out.hand].sort(),
			"mismas claves de propiedad y la de a mano, con la suya",
		);
		assert.deepEqual(
			out.afterThird,
			out.after,
			"rehacer otra vez no cambia nada",
		);
		assert.equal(
			out.instAfter.main,
			out.instBefore.main,
			"la instancia sigue apuntando al mismo componente",
		);
		assert.equal(
			out.instAfter.etiqueta,
			"Cambiado",
			"el texto puesto por propiedad se conserva",
		);
		assert.ok(out.instAfter.texts.includes("Cambiado"));
		assert.ok(
			out.instAfter.slotKids.includes("mio"),
			"lo que la instancia metió en el hueco sigue ahí",
		);
		assert.match(
			String(out.slotBefore.refs.visible),
			/^Mostrar hueco#/,
			"el hueco lleva a la vez slotContentId y visible",
		);
		assert.deepEqual(out.slotAfter.refs, out.slotBefore.refs);
		assert.equal(out.headers, 1);
		assert.equal(out.pages, 1);
		assert.equal(out.sets, 1);
		assert.deepEqual(out.report.variants, { created: 0, updated: 2, kept: 0 });
		assert.ok(
			out.secondWarnings.some((w: string) => w.startsWith("PROPERTY_KEPT")),
		);
	});

	it("kit/build-component@1 con una prop de variante hecha a mano en Figma: no escribe, informa del desfase (SHEET_DRIFT) y la decisión `map` empareja las variantes de la web", async () => {
		const base = miniSheetPlan(false) as Record<string, any>;
		const target = {
			page: { name: "fcc kit hoja d", key: "fcc:sheet-page:fcc-kit-d" },
			set: { name: "fcc-kit-hoja-d", key: "fcc:sheet:fcc-kit-d" },
		};
		const planD = {
			...base,
			sheet: {
				...base["sheet"],
				key: "fcc-kit-d",
				title: "fcc-kit-hoja-d",
				page: target.page,
			},
			target,
		};
		const out = await step(
			`${PREP}
			for (const style of ['Medium', 'Semi Bold']) await figma.loadFontAsync({ family: 'Inter', style });
			for (const c of await figma.variables.getLocalVariableCollectionsAsync()) if (c.name === ${JSON.stringify(SHEET_COLLECTION)}) c.remove();
			const col = figma.variables.createVariableCollection(${JSON.stringify(SHEET_COLLECTION)});
			const mk = (name, rgb) => { const v = figma.variables.createVariable(name, col, 'COLOR'); v.setValueForMode(col.defaultModeId, { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 }); };
			mk('gris', [250, 250, 250]); mk('texto', [17, 24, 39]);
			const iconPage = await kit.page.ensure({ key: 'fcc:kit-test-iconos', name: 'fcc-kit-iconos' });
			for (const c of [...iconPage.children]) c.remove();
			const plus = figma.createComponent(); plus.name = 'icons/plus'; plus.resize(24, 24); iconPage.appendChild(plus);
			const bar = figma.createRectangle(); bar.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]; plus.appendChild(bar);
			await figma.setCurrentPageAsync(page);
			const enc = (plan) => ({ plan: new TextEncoder().encode(JSON.stringify(plan)) });
			const stepParams = { sheet: 'fcc-kit-d', scratch: false };
			const plan = ${JSON.stringify(planD)};
			await kit.steps.buildComponent(stepParams, enc(plan));
			const sheetPage = () => figma.root.children.find((p) => p.getSharedPluginData('fcc', 'key') === 'fcc:sheet-page:fcc-kit-d');
			const setNow = () => sheetPage().findAllWithCriteria({ types: ['COMPONENT_SET'] })[0];
			// lo que le pasó a una hoja real: alguien añadió a mano la prop de variante «card»
			const set = setNow();
			for (const v of set.children) v.name = v.name + ', card=no';
			const extra = set.children[0].clone(); set.appendChild(extra); extra.name = 'tamano=sm, card=title';
			const snapshot = () => JSON.stringify(sheetPage().findAll(() => true).map((n) => n.id));
			const before = snapshot();
			const ids = setNow().children.map((c) => c.id);
			const blocked = await kit.steps.buildComponent(stepParams, enc(plan));
			const untouched = snapshot() === before;
			const report = blocked.report;
			const decided = { ...plan, sheet: { ...plan.sheet, drift: { decision: 'map', values: { card: 'no' }, fingerprint: report.drift.fingerprint } } };
			const mapped = await kit.steps.buildComponent(stepParams, enc(decided));
			const afterIds = setNow().children.map((c) => c.id + ':' + c.name);
			const changed = { ...decided, sheet: { ...decided.sheet, drift: { ...decided.sheet.drift, fingerprint: { ...decided.sheet.drift.fingerprint, variants: [] } } } };
			const again = await kit.steps.buildComponent(stepParams, enc(changed));
			const skip = await kit.steps.buildComponent(stepParams, enc({ ...decided, sheet: { ...decided.sheet, drift: { decision: 'figma', fingerprint: report.drift.fingerprint } } }));
			return { ids, afterIds, untouched, drift: report.drift, warnings: (blocked.warnings || []).map((w) => w.code), skipped: report.skipped,
				mappedWarnings: (mapped.warnings || []).map((w) => w.code), mappedVariants: mapped.report.variants, againReason: again.report.drift && again.report.drift.reason, skipReport: skip.report, skipWarnings: (skip.warnings || []).map((w) => w.code) };`,
		);
		console.log(`[hallazgo build-component desfase] ${JSON.stringify(out)}`);
		assert.equal(out.untouched, true, "con desfase no se escribe nada");
		assert.deepEqual(out.warnings, ["SHEET_DRIFT"]);
		assert.equal(out.skipped, "drift");
		assert.deepEqual(out.drift.figmaOnlyProps, { card: ["no", "title"] });
		assert.equal(out.drift.figmaOnlyVariants.length, 3);
		assert.deepEqual(out.drift.webOnlyVariants.sort(), [
			"tamano=lg",
			"tamano=sm",
		]);
		assert.deepEqual(
			out.afterIds.map((x: string) => x.split(":").slice(0, 2).join(":")),
			out.ids,
			"con `map` ninguna variante cambia de id y no se añade ninguna",
		);
		assert.deepEqual(out.mappedVariants, { created: 0, updated: 2, kept: 1 });
		assert.equal(out.againReason, "fingerprint-changed");
		assert.equal(out.skipReport.skipped, "figma");
		assert.deepEqual(out.skipWarnings, ["DRIFT_FIGMA_WINS"]);
	});
	it("kit/compose@1 con un compose mínimo genérico: frame por clave, variables y estilo ligados, instancia con su variante, su texto y su hueco; repetir no duplica", async () => {
		const COMPOSE_PAGE = "fcc kit compose";
		const compose = {
			contract: "compose@1",
			key: "fcc-kit-compose",
			title: "fcc kit ficha",
			target: { page: COMPOSE_PAGE, width: 400 },
			root: {
				stack: "VERTICAL",
				gap: "fcc-kit/espacio",
				padding: ["fcc-kit/espacio", "fcc-kit/espacio"],
				fill: "fcc-kit/superficie",
				radius: "fcc-kit/radio",
				children: [
					{
						text: "Título de la ficha",
						style: "fcc-kit/titulo",
						color: "fcc-kit/tinta",
					},
					{
						stack: "HORIZONTAL",
						gap: "fcc-kit/espacio",
						sizing: { h: "FILL", v: "HUG" },
						name: "Fila",
						children: [
							{
								use: "fcc-kit-boton",
								variant: { tipo: "b" },
								props: { Etiqueta: "Guardar" },
								slots: {
									Hueco: [
										{
											text: "Dentro del hueco",
											style: "fcc-kit/titulo",
											color: "fcc-kit/tinta",
										},
									],
								},
								name: "Botón",
							},
						],
					},
				],
			},
		};
		const out = await step(
			`${PREP}
			const col = figma.variables.createVariableCollection(${JSON.stringify(COLLECTION)});
			const num = (name, value) => { const v = figma.variables.createVariable(name, col, 'FLOAT'); v.setValueForMode(col.defaultModeId, value); };
			const color = (name, rgb) => { const v = figma.variables.createVariable(name, col, 'COLOR'); v.setValueForMode(col.defaultModeId, { r: rgb[0], g: rgb[1], b: rgb[2] }); };
			num('fcc-kit/espacio', 12); num('fcc-kit/radio', 8);
			color('fcc-kit/superficie', [0.95, 0.95, 0.95]); color('fcc-kit/tinta', [0.1, 0.1, 0.1]);
			const style = figma.createTextStyle(); style.name = 'fcc-kit/titulo'; style.fontName = { family: 'Inter', style: 'Bold' }; style.fontSize = 20;
			// El set de la hoja: dos variantes, un texto con propiedad y un hueco que comparte una propiedad «Hueco» (Figma llama a la capa como la propiedad)
			const holder = await kit.page.ensure({ key: 'fcc:kit-test-botones', name: 'fcc kit botones' });
			for (const c of [...holder.children]) c.remove();
			const mk = (name) => {
				const c = figma.createComponent(); c.name = name; holder.appendChild(c); c.layoutMode = 'VERTICAL';
				const t = figma.createText(); t.characters = 'Etiqueta'; t.name = 'etiqueta'; c.appendChild(t);
				return c;
			};
			const variants = [mk('tipo=a'), mk('tipo=b')];
			const set = figma.combineAsVariants(variants, holder); set.name = 'fcc-kit Boton';
			const key = set.addComponentProperty('Etiqueta', 'TEXT', 'Etiqueta');
			for (const c of set.children) c.findOne((n) => n.name === 'etiqueta').componentPropertyReferences = { characters: key };
			for (const c of set.children) c.createSlot().name = 'zona';
			kit.slot.share([...set.children], 'Hueco', { layer: 'zona' });
			set.setSharedPluginData('fcc', 'key', 'fcc:sheet:fcc-kit-boton');
			const bindings = (n) => n.boundVariables || {};
			const run = () => kit.steps.compose({ compose: params.compose, sheets: [{ key: 'fcc-kit-boton', title: 'fcc-kit Boton' }] }, {});
			const first = await run();
			const frames = () => figma.root.children.flatMap((p) => p.findAllWithCriteria({ types: ['FRAME'] }).filter((f) => f.getSharedPluginData('fcc', 'key') === 'fcc:compose:fcc-kit-compose'));
			const f1 = frames()[0];
			const read = (f) => {
				const row = f.children[1];
				const inst = row.children[0];
				const slot = inst.findOne((n) => n.type === 'SLOT');
				return { frames: frames().length, name: f.name, width: f.width, layout: f.layoutMode, fills: f.fills.length, fillColor: f.fills[0] && f.fills[0].color && Math.round(f.fills[0].color.r * 100), fillBound: !!(f.fills[0] && f.fills[0].boundVariables && f.fills[0].boundVariables.color),
					gap: f.itemSpacing, gapBound: !!bindings(f).itemSpacing, padBound: !!bindings(f).paddingTop && !!bindings(f).paddingLeft, radiusBound: !!bindings(f).topLeftRadius, radius: f.topLeftRadius,
					title: { chars: f.children[0].characters, style: f.children[0].textStyleId !== '', color: !!(f.children[0].fills[0] && f.children[0].fills[0].boundVariables && f.children[0].fills[0].boundVariables.color) },
					rowSizing: row.layoutSizingHorizontal, rowName: row.name, instName: inst.name, instVariant: inst.variantProperties, label: inst.findOne((n) => n.type === 'TEXT' && n.name === 'etiqueta').characters,
					slot: slot ? { name: slot.name, refs: slot.componentPropertyReferences, kids: slot.children.map((c) => c.type + ':' + (c.characters || c.name)) } : null };
			};
			const before = read(f1);
			const ids = f1.children.map((c) => c.id);
			const second = await run();
			const f2 = frames()[0];
			const after = read(f2);
			const pages = figma.root.children.filter((p) => p.name === ${JSON.stringify(COMPOSE_PAGE)});
			return { before, after, sameFrame: f1.id === f2.id, pages: pages.length, pageKey: pages[0] && pages[0].getSharedPluginData('fcc', 'key'), tag: f1.getSharedPluginData('fcc', 'key'),
				newChildren: f2.children.every((c) => !ids.includes(c.id)), firstCreated: first.createdNodeIds.length, secondCreated: second.createdNodeIds.length, secondRemoved: (second.removedNodeIds || []).length,
				warnings: [...(first.warnings || []), ...(second.warnings || [])].map((w) => w.code), report: second.report };`,
			{ compose },
		);
		console.log(`[hallazgo kit/compose] ${JSON.stringify(out)}`);
		assert.equal(out.sameFrame, true, "repetir el paso rehace el mismo frame");
		assert.equal(out.pages, 1, "y no crea otra página");
		assert.equal(out.pageKey, "fcc:compose-page:fcc-kit-compose");
		assert.equal(out.tag, "fcc:compose:fcc-kit-compose");
		assert.equal(out.newChildren, true);
		for (const state of [out.before, out.after]) {
			assert.equal(state.frames, 1);
			assert.equal(state.name, "fcc kit ficha");
			assert.equal(state.width, 400);
			assert.equal(state.layout, "VERTICAL");
			assert.equal(state.fillBound, true, "el relleno va ligado a su variable");
			assert.equal(
				state.fillColor,
				95,
				"y lleva el color de la variable, también al rehacer el frame (si no, se queda en negro)",
			);
			assert.equal(state.gap, 12);
			assert.equal(state.gapBound, true);
			assert.equal(state.padBound, true);
			assert.equal(state.radiusBound, true);
			assert.equal(state.radius, 8);
			assert.deepEqual(state.title, {
				chars: "Título de la ficha",
				style: true,
				color: true,
			});
			assert.equal(state.rowSizing, "FILL");
			assert.equal(state.instVariant.tipo, "b");
			assert.equal(state.label, "Guardar");
			assert.deepEqual(state.slot?.kids, ["TEXT:Dentro del hueco"]);
		}
		assert.deepEqual(out.warnings, []);
		assert.ok(out.secondRemoved >= 2, "lo de antes va como quitado");
	});
});
