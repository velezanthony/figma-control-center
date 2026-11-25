// El simulador no ejecuta los pasos del kit (no hay Figma): reconoce el código fijo de un paso `use` por su huella y contesta
// un StepResult hecho desde sus `params`. Reglas fijas para que los escenarios puedan comprobar el informe:
// un enlace por texto cuenta 1 salvo que su texto diga «no existe» (cuenta 0 y avisa LINK_ZERO); uno por filas cuenta 2.
import type { FakeReply } from "#adapters/cdp/testing/fake-cdp-server.ts";

// El código fijo de un paso; `build-screen` lleva además el módulo recognize@1 entre `const recognize` y la llamada
const KIT_STEP_CODE =
	/@contract step@1 · (kit\/[a-z-]+@1)\n(?:const recognize =[\s\S]*?;\n)?return await kit\.steps\.(\w+)\(params, assets(?:, recognize)?\);/;
const PARAMS_LINE =
	/^\(async \(\) => \{const params = (.*);const assets = .*;const kit = [^;]*;$/m;

type Area = {
	name: string;
	screens: { frame: string; shell?: string }[];
	shell?: { default: string };
	links?: (
		| { from: string; text: string; to: string }
		| { from: string; rows: true; to: string }
	)[];
	fills?: { frame: string }[];
};
type Params = {
	area: Area;
	shared: {
		name: string;
		variantProp: string;
		from: { area: string; frame: string; value: string }[];
	}[];
};

const PLAN_ASSET = /"plan":figma\.base64Decode\("([^"]*)"\)/;

type Plan = {
	screen: string;
	target: { page: { name: string } };
	root: { id?: string }[];
	images: Record<string, unknown>;
	rules?: string[];
	fingerprints?: Record<string, { title: string }>;
};

const countNodes = (nodes: readonly unknown[]): number =>
	nodes.reduce<number>(
		(sum, n) => sum + 1 + countNodes((n as { kids?: unknown[] }).kids ?? []),
		0,
	);

// `kit/build-screen@1`: el plan llega como asset (base64); la respuesta cuenta lo que pintaría el kit, sin pintar
function buildScreenReply(expression: string): FakeReply | null {
	const b64 = PLAN_ASSET.exec(expression)?.[1];
	if (b64 === undefined) return null;
	const plan = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Plan;
	// El simulador no reconoce nada: informa de una coincidencia por cada regla y cada huella que el plan lleva, sobre la primera
	// raíz, para que los escenarios comprueben que el informe llega al histórico
	const node = plan.root[0]?.id ?? "";
	const matches = [
		...(plan.rules ?? []).map((set) => ({ node, set, by: `rule:${set}` })),
		...Object.values(plan.fingerprints ?? {}).map((fp) => ({
			node,
			set: fp.title,
			by: "fingerprint",
		})),
	];
	const instances: Record<string, number> = {};
	for (const m of matches) instances[m.set] = (instances[m.set] ?? 0) + 1;
	return value({
		createdNodeIds: ["21:1", "21:2"],
		mutatedNodeIds: [],
		report: {
			screen: plan.screen,
			page: plan.target.page.name,
			frameId: "21:2",
			nodes: countNodes(plan.root),
			images: Object.keys(plan.images).length,
			icons: 0,
			instances,
			matches,
			moved: [],
			movedCount: 0,
			wrapped: [],
			wrappedCount: 0,
			untokenized: 0,
		},
	});
}

type SheetPlan = {
	sheet: { key: string; description?: string };
	target: { page: { name: string } };
	variants: { root: { id?: string }[] }[];
	rules?: string[];
	fingerprints?: Record<string, { title: string }>;
	properties?: unknown;
};

// `kit/build-component@1`: como buildScreen, el plan llega como asset; cuenta variantes y una coincidencia simulada por regla y huella
function buildComponentReply(expression: string): FakeReply | null {
	const b64 = PLAN_ASSET.exec(expression)?.[1];
	if (b64 === undefined) return null;
	const plan = JSON.parse(
		Buffer.from(b64, "base64").toString("utf8"),
	) as SheetPlan;
	// Una hoja cuya descripción empieza por «DESFASE» simula que Figma va por delante de la web: no escribe y devuelve el informe
	if (plan.sheet.description?.startsWith("DESFASE") === true) {
		return value({
			createdNodeIds: [],
			mutatedNodeIds: [],
			warnings: [
				{
					code: "SHEET_DRIFT",
					message: `La hoja «${plan.sheet.key}» NO se ha escrito`,
				},
			],
			report: {
				sheet: plan.sheet.key,
				skipped: "drift",
				drift: {
					sheet: plan.sheet.key,
					set: { id: "22:9", name: plan.sheet.key, page: "Hoja" },
					reason: "drift",
					figmaOnlyProps: { card: ["no", "title"] },
					figmaOnlyVariants: ["tamano=sm, card=no"],
					webOnlyVariants: ["tamano=sm"],
					handMadeProperties: [],
					usage: { total: 0, pages: [] },
					handMadeLayers: [],
					overridesAtRisk: { total: 0, affected: [] },
					handMadeUsage: {
						total: 0,
						pages: [],
						kinds: { properties: 0, overrides: 0, swaps: 0, slots: 0 },
					},
					fingerprint: {
						variantProps: {},
						variants: [],
						properties: [],
						layers: [],
					},
				},
			},
		});
	}
	const node = plan.variants[0]?.root[0]?.id ?? "";
	const matches = [
		...(plan.rules ?? []).map((set) => ({ node, set, by: `rule:${set}` })),
		...Object.values(plan.fingerprints ?? {}).map((fp) => ({
			node,
			set: fp.title,
			by: "fingerprint",
		})),
	];
	return value({
		createdNodeIds: ["22:1", "22:2"],
		mutatedNodeIds: [],
		report: {
			sheet: plan.sheet.key,
			page: plan.target.page.name,
			setId: "22:2",
			variants: { created: plan.variants.length, updated: 0, kept: 0 },
			properties: { created: 0, updated: 0, kept: 0 },
			instances: { before: 0, after: 0 },
			overrides: { before: 0, after: 0 },
			matches,
			moved: [],
			wrapped: [],
			untokenized: 0,
		},
	});
}

type ComposeBlock = {
	stack?: string;
	text?: string;
	use?: string | { key: string };
	children?: ComposeBlock[];
	slots?: Record<string, ComposeBlock[]>;
};
type ComposeParams = {
	compose: {
		key: string;
		target: { page: string };
		root: ComposeBlock;
	};
};

// Los compose que ya pintó este proceso: el segundo paso con la misma clave rehace el frame en vez de crear otro, como el kit
const composeSeen = new Set<string>();
const COMPOSE_PAGE_ID = "23:1";
const COMPOSE_FRAME_ID = "23:2";

// `kit/compose@1`: cuenta lo que pintaría el kit desde los bloques del compose, sin pintar
function composeReply(raw: string): FakeReply {
	const { compose } = JSON.parse(raw) as ComposeParams;
	let frames = 0;
	let texts = 0;
	let slots = 0;
	let blocks = 0;
	const instances: Record<string, number> = {};
	const walk = (block: ComposeBlock, isRoot: boolean) => {
		if (!isRoot) blocks += 1;
		if (block.stack !== undefined) {
			if (!isRoot) frames += 1;
			for (const child of block.children ?? []) walk(child, false);
		} else if (block.text !== undefined) texts += 1;
		else if (typeof block.use === "string") {
			instances[block.use] = (instances[block.use] ?? 0) + 1;
			for (const content of Object.values(block.slots ?? {})) {
				slots += content.length;
				for (const child of content) walk(child, false);
			}
		}
	};
	walk(compose.root, true);
	const rebuilt = composeSeen.has(compose.key);
	composeSeen.add(compose.key);
	const children = Array.from({ length: blocks }, (_, i) => `23:${3 + i}`);
	// Al rehacer se retiran los hijos de antes (el simulador no guarda sus ids: se inventan otros, distintos de los nuevos)
	const previous = rebuilt
		? Array.from({ length: blocks }, (_, i) => `23:${3 + blocks + i}`)
		: [];
	const report = {
		compose: compose.key,
		page: compose.target.page,
		pageId: COMPOSE_PAGE_ID,
		frameId: COMPOSE_FRAME_ID,
		rebuilt,
		frames,
		texts,
		instances,
		slots,
	};
	return value(
		rebuilt
			? {
					createdNodeIds: children,
					mutatedNodeIds: [COMPOSE_FRAME_ID],
					removedNodeIds: previous,
					report,
				}
			: {
					createdNodeIds: [COMPOSE_PAGE_ID, COMPOSE_FRAME_ID, ...children],
					mutatedNodeIds: [],
					report,
				},
	);
}

export function kitStepReply(expression: string): FakeReply | null {
	const step = KIT_STEP_CODE.exec(expression)?.[2];
	const raw = PARAMS_LINE.exec(expression)?.[1];
	if (step === undefined || raw === undefined) return null;
	if (step === "buildScreen") return buildScreenReply(expression);
	if (step === "buildComponent") return buildComponentReply(expression);
	if (step === "compose") return composeReply(raw);
	const { area, shared } = JSON.parse(raw) as Params;
	const id = (n: number) => `20:${n}`;
	switch (step) {
		case "place": {
			const frames = area.screens.map((s, i) => ({
				frame: s.frame,
				id: id(i + 1),
				height: 900,
				...(area.shell !== undefined && {
					shell: s.shell ?? area.shell.default,
				}),
			}));
			return value({
				mutatedNodeIds: frames.map((f) => f.id),
				report: { frames },
			});
		}
		case "share": {
			const entries = shared.flatMap((g) =>
				g.from
					.filter((f) => f.area === area.name)
					.map((f) => ({
						group: g.name,
						area: area.name,
						frame: f.frame,
						variant: `${g.variantProp}=${f.value}`,
					})),
			);
			return value({
				mutatedNodeIds: entries.map((_, i) => id(50 + i)),
				report: { shared: entries },
			});
		}
		case "links": {
			const links = (area.links ?? []).map((l) => {
				const count = "rows" in l ? 2 : l.text.includes("no existe") ? 0 : 1;
				return {
					area: area.name,
					from: l.from,
					...("rows" in l ? { rows: true } : { text: l.text }),
					to: l.to,
					count,
					unchanged: 0,
				};
			});
			const zero = links.filter((l) => l.count === 0);
			return value({
				mutatedNodeIds: links.flatMap((l, i) =>
					l.count > 0 ? [id(70 + i)] : [],
				),
				...(zero.length > 0 && {
					warnings: zero.map((l) => ({
						code: "LINK_ZERO",
						message: `${l.from}: ${"text" in l ? l.text : "filas"} → ${l.to} ×0`,
					})),
				}),
				report: { links },
			});
		}
		case "fillImage": {
			const fills = (area.fills ?? []).map((f, i) => ({
				frame: f.frame,
				nodeId: id(90 + i),
				size: [600, 400],
				hash: "a".repeat(8),
			}));
			return value({
				mutatedNodeIds: fills.map((f) => f.nodeId),
				report: { fills },
			});
		}
		case "layoutCheck":
			return value({
				report: {
					layout: area.screens.map((s, i) => ({
						area: area.name,
						frame: s.frame,
						frameId: id(110 + i),
						overlaps: 0,
						samples: [],
						collapsed: 0,
						misalignedRows: 0,
					})),
				},
				mutatedNodeIds: [],
			});
		default:
			return null;
	}
}

const value = (result: Record<string, unknown>): FakeReply => ({
	kind: "value",
	value: { createdNodeIds: [], ...result },
});
