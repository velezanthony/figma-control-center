// Enlaces del prototipo: nodos pulsables por su texto o por filas, un clic que navega a un frame y reponer lo que había
// al rehacer un contenido. Trampas: 3 (otra página), 4 (capa de instancia), 5 (duración en 32 bits), 15 (texto oculto) y
// 16 (recorrer por tipo).
import { setNameOf } from "./components.ts";
import { fail, figmaApi, note } from "./core.ts";
import {
	descendantsOfType,
	LINKABLE_TYPES,
	pageOf,
	topFrameName,
	visibleText,
} from "./tree.ts";
import type { FrameNode, Reaction, SceneNode } from "./types.ts";

export type Clickable = {
	readonly names: readonly string[];
	readonly namePrefixes: readonly string[];
	readonly components: readonly string[];
	readonly parts?:
		| readonly { readonly name: string; readonly insideComponent: string }[]
		| undefined;
};

export type Transition = {
	readonly type: string;
	readonly easing: string;
	readonly duration: number;
};

export type SavedLink = { text: string; reactions: Reaction[] };

type ComponentNames = Map<string, string | null>;

// El set (o componente) de una instancia; null para lo que no es una instancia. Se guarda por id: una llamada no repite
async function componentOf(
	node: SceneNode | null,
	cache: ComponentNames,
): Promise<string | null> {
	if (node === null || node.type !== "INSTANCE") return null;
	const cached = cache.get(node.id);
	if (cached !== undefined) return cached;
	const name = await setNameOf(node);
	cache.set(node.id, name);
	return name;
}

async function isClickable(
	node: SceneNode,
	clickable: Clickable,
	cache: ComponentNames,
): Promise<boolean> {
	if (node.type === "FRAME") {
		if (clickable.names.includes(node.name)) return true;
		if (clickable.namePrefixes.some((prefix) => node.name.startsWith(prefix)))
			return true;
	}
	const own = await componentOf(node, cache);
	if (own !== null && clickable.components.includes(own)) return true;
	for (const part of clickable.parts ?? []) {
		if (
			node.name === part.name &&
			(await componentOf(node.parent as SceneNode | null, cache)) ===
				part.insideComponent
		)
			return true;
	}
	return false;
}

async function insideComponent(
	node: SceneNode,
	root: SceneNode,
	component: string,
	cache: ComponentNames,
): Promise<boolean> {
	for (let p = node.parent; p !== null && p !== root; p = p.parent) {
		if ((await componentOf(p as SceneNode, cache)) === component) return true;
	}
	return false;
}

const matcher = (
	text: string,
	match: "exact" | "start" | "contains",
): ((candidate: string) => boolean) =>
	match === "exact"
		? (candidate) => candidate === text
		: match === "start"
			? (candidate) => candidate.startsWith(text)
			: (candidate) => candidate.includes(text);

// Los nodos pulsables de un frame cuyo texto visible es `text` (o empieza por él, o lo contiene)
export async function byText(
	frame: SceneNode,
	text: string,
	options: {
		match?: "exact" | "start" | "contains" | undefined;
		clickable: Clickable;
		skipInside?: string | undefined;
	},
): Promise<SceneNode[]> {
	const matches = matcher(text, options.match ?? "exact");
	const cache: ComponentNames = new Map();
	const found: SceneNode[] = [];
	for (const node of descendantsOfType(frame, ["FRAME", "INSTANCE"])) {
		if (!(await isClickable(node, options.clickable, cache))) continue;
		if (
			options.skipInside !== undefined &&
			(await insideComponent(node, frame, options.skipInside, cache))
		)
			continue;
		if (matches(visibleText(node))) found.push(node);
	}
	return found;
}

// Las filas de tabla (por nombre) que están dentro de su cuerpo (por nombre)
export function rows(
	frame: SceneNode,
	rules: {
		readonly row: readonly string[];
		readonly body: readonly string[];
	},
): SceneNode[] {
	return descendantsOfType(frame, ["FRAME"]).filter(
		(node) =>
			rules.row.includes(node.name) &&
			node.parent !== null &&
			rules.body.includes(node.parent.name),
	);
}

const reactionFor = (
	destinationId: string,
	transition: Transition,
): Reaction[] => [
	{
		trigger: { type: "ON_CLICK" },
		actions: [
			{
				type: "NODE",
				destinationId,
				navigation: "NAVIGATE",
				// Sin transición, Figma dice `null` (cambio instantáneo)
				transition:
					transition.type === "INSTANT"
						? null
						: ({
								type: transition.type,
								easing: { type: transition.easing },
								duration: transition.duration,
							} as never),
				preserveScrollPosition: false,
				resetVideoPosition: false,
			},
		],
	},
];

// Un número guardado en Figma vuelve en coma flotante de 32 bits (opacidad): se compara con tolerancia
const NEAR = 1e-6;
const near = (a: number, b: number) =>
	Math.abs(a - b) <= NEAR * Math.max(1, Math.abs(a), Math.abs(b));

type Loose = {
	type?: string;
	destinationId?: string | null;
	navigation?: string;
	transition?: {
		type?: string;
		easing?: { type?: string };
		duration?: number;
	} | null;
	trigger?: { type?: string } | null;
	actions?: Loose[];
};

function sameAction(a: Loose, b: Loose): boolean {
	if (
		a.type !== b.type ||
		a.destinationId !== b.destinationId ||
		a.navigation !== b.navigation
	)
		return false;
	const x = a.transition ?? null;
	const y = b.transition ?? null;
	if (x === null || y === null) return x === y;
	return (
		x.type === y.type &&
		x.easing?.type === y.easing?.type &&
		near(x.duration ?? 0, y.duration ?? 0)
	);
}

export function sameReactions(
	current: readonly Reaction[],
	wanted: readonly Reaction[],
): boolean {
	if (current.length !== wanted.length) return false;
	return current.every((reaction, i) => {
		const a = reaction as Loose;
		const b = wanted[i] as Loose;
		const actions = a.actions ?? [];
		const others = b.actions ?? [];
		return (
			a.trigger?.type === b.trigger?.type &&
			actions.length === others.length &&
			actions.every((action, j) => sameAction(action, others[j] as Loose))
		);
	});
}

type Reactive = {
	reactions: readonly Reaction[];
	setReactionsAsync(reactions: Reaction[]): Promise<void>;
};

const messageOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// El disparador de una reacción como texto estable (claves ordenadas): dos reacciones con el mismo compiten por el nodo
function triggerKey(reaction: Reaction): string {
	const trigger = (reaction as Loose).trigger ?? null;
	if (trigger === null) return "null";
	return JSON.stringify(
		Object.entries(trigger).sort(([a], [b]) => a.localeCompare(b)),
	);
}

// Las reacciones de `current` con las de `incoming` encima: la del mismo disparador se sustituye en su sitio y las demás (el
// hover de un botón, que trae de su componente) se conservan
export function withReactions(
	current: readonly Reaction[],
	incoming: readonly Reaction[],
): Reaction[] {
	const next = [...current];
	for (const reaction of incoming) {
		const at = next.findIndex((r) => triggerKey(r) === triggerKey(reaction));
		if (at === -1) next.push(reaction);
		else next[at] = reaction;
	}
	return next;
}

// Un clic en `node` que navega al frame `destination`; el resto de sus reacciones se conserva. Si ya lleva ese clic no se toca
export async function linkTo(
	node: SceneNode,
	destination: FrameNode,
	options: { transition: Transition },
): Promise<{ changed: boolean }> {
	const from = pageOf(node);
	const to = pageOf(destination);
	if (from === null || to === null || from.id !== to.id) {
		fail(
			"LINK_OTHER_PAGE",
			`«${node.name}» y su destino «${destination.name}» no están en la misma página: un enlace del prototipo solo puede ir a un frame de su página.`,
			"Pon el destino en la página del origen o quita ese enlace de areas@1.",
		);
	}
	const target = node as unknown as Reactive;
	const wanted = withReactions(
		target.reactions,
		reactionFor(destination.id, options.transition),
	);
	if (sameReactions(target.reactions, wanted)) return { changed: false };
	await target.setReactionsAsync(wanted);
	note.mutated(node);
	// Una reacción en una capa de una instancia queda como cambio de la instancia: se relee para contarla
	if (!sameReactions(target.reactions, wanted)) {
		note.warn(
			"REACTION_NOT_KEPT",
			`«${node.name}» no conservó el enlace que se le puso.`,
			node.id,
		);
	}
	return { changed: true };
}

// El set de la instancia (o variante) que contiene al nodo, o el propio componente: el único sitio donde vale un cambio de variante
async function ownSetId(node: SceneNode): Promise<string | null> {
	for (
		let n: SceneNode | null = node;
		n !== null;
		n = n.parent as SceneNode | null
	) {
		if (n.type !== "INSTANCE" && n.type !== "COMPONENT") continue;
		const main = n.type === "INSTANCE" ? await n.getMainComponentAsync() : n;
		if (main === null) return null;
		return main.parent?.type === "COMPONENT_SET" ? main.parent.id : main.id;
	}
	return null;
}

// Por qué una acción guardada no vale en `target` (null si vale). Medido en el archivo de pruebas (2026-11-15): un cambio de variante
// en un marco o en una instancia de otro set lo rechaza Figma y la excepción tumba el paso
async function invalidAction(
	target: SceneNode,
	action: Loose,
): Promise<string | null> {
	if (typeof action.destinationId !== "string") return null;
	const destination = (await figmaApi().getNodeByIdAsync(
		action.destinationId,
	)) as SceneNode | null;
	if (destination === null || destination.removed === true)
		return "el destino ya no existe";
	if (action.navigation === "CHANGE_TO") {
		const set = await ownSetId(target);
		return set !== null && destination.parent?.id === set
			? null
			: `un cambio de variante solo vale en una instancia de su set y «${target.name}» es ${target.type === "INSTANCE" ? "una instancia de otro set" : `un ${target.type}`}`;
	}
	const here = pageOf(target);
	return here !== null && pageOf(destination)?.id === here.id
		? null
		: "el destino está en otra página";
}

async function describeAction(reaction: Loose, action: Loose): Promise<string> {
	const destination =
		typeof action.destinationId === "string"
			? await figmaApi().getNodeByIdAsync(action.destinationId)
			: null;
	return `${reaction.trigger?.type ?? "?"} → ${action.navigation ?? action.type ?? "?"}${destination === null ? "" : ` «${destination.name}»`}`;
}

// Las reacciones guardadas que valen en `target` y la descripción de las que no (con el porqué). Una que no vale y cuyo
// disparador ya lleva el nodo (el hover que trae de su propio componente) se descarta sin avisar: no se pierde nada
async function validFor(
	target: SceneNode,
	reactions: readonly Reaction[],
	own: readonly Reaction[],
): Promise<{ kept: Reaction[]; dropped: string[] }> {
	const covered = new Set(own.map(triggerKey));
	const kept: Reaction[] = [];
	const dropped: string[] = [];
	for (const reaction of reactions) {
		const r = reaction as Loose;
		let why: string | null = null;
		for (const action of r.actions ?? []) {
			why = await invalidAction(target, action);
			if (why !== null) {
				if (!covered.has(triggerKey(reaction)))
					dropped.push(`${await describeAction(r, action)} (${why})`);
				break;
			}
		}
		if (why === null) kept.push(reaction);
	}
	return { kept, dropped };
}

// Las reacciones de cada nodo con texto visible dentro de `node` (y del propio nodo), para reponerlas tras rehacerlo
export function capture(node: SceneNode): SavedLink[] {
	const saved: SavedLink[] = [];
	for (const x of [node, ...descendantsOfType(node, LINKABLE_TYPES)]) {
		const reactions = (x as unknown as { reactions?: readonly Reaction[] })
			.reactions;
		if (reactions === undefined || reactions.length === 0) continue;
		const text = visibleText(x);
		if (text !== "") saved.push({ text, reactions: [...reactions] });
	}
	return saved;
}

// Pone cada reacción guardada en el primer nodo pulsable (o instancia) de `nodes` con el mismo texto
export async function restore(
	nodes: SceneNode | readonly SceneNode[],
	saved: readonly SavedLink[],
	options: { clickable: Clickable },
): Promise<{ restored: number; total: number }> {
	const cache: ComponentNames = new Map();
	const candidates: SceneNode[] = [];
	const roots = Array.isArray(nodes) ? nodes : [nodes];
	const within = roots.flatMap((root) => [
		root,
		...descendantsOfType(root, ["FRAME", "INSTANCE"]),
	]);
	for (const x of within) {
		if (
			x.type === "INSTANCE" ||
			(await isClickable(x, options.clickable, cache))
		)
			candidates.push(x);
	}
	let restored = 0;
	for (const link of saved) {
		const target = candidates.find((x) => visibleText(x) === link.text);
		if (target === undefined) continue;
		// Lo que no vale en el nodo nuevo (el cambio de variante de un componente viejo) se descarta y se dice cuál
		const node = target as unknown as Reactive;
		const { kept, dropped } = await validFor(
			target,
			link.reactions,
			node.reactions,
		);
		const where = `«${link.text}» (marco «${topFrameName(target)}»)`;
		if (dropped.length > 0) {
			note.warn(
				"REACTION_DROPPED",
				`${where}: no se repone ${dropped.join("; ")}.`,
				target.id,
			);
		}
		if (kept.length === 0) continue;
		const next = withReactions(node.reactions, kept);
		if (!sameReactions(node.reactions, next)) {
			// Figma puede rechazar algo que el kit no prevé: se avisa y se sigue, nunca deja el paso a medias
			try {
				await node.setReactionsAsync(next);
			} catch (e) {
				note.warn(
					"REACTION_REJECTED",
					`${where}: Figma rechazó sus enlaces y se queda sin ellos: ${messageOf(e)}`,
					target.id,
				);
				continue;
			}
			note.mutated(target);
		}
		restored += 1;
	}
	return { restored, total: saved.length };
}
