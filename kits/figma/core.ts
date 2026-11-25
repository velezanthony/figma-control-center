// Lo común a todas las piezas: el `figma` de cada llamada, el seguimiento del paso y los errores con siguiente paso.
import type { PluginAPI } from "@figma/plugin-typings/plugin-api-standalone.d.ts";
import {
	FAIL_MARKER,
	type Ref,
	type StepResult,
	type StepWarning,
	type Tracker,
} from "./types.ts";

// `figma` se lee de globalThis en CADA llamada: el kit no lo guarda al instalarse (la pestaña puede recargarse)
export const figmaApi = (): PluginAPI =>
	(globalThis as unknown as { figma: PluginAPI }).figma;

// Lo que el kit recuerda, atado al `figma` de la pestaña: si la pestaña se recarga, empieza de cero
type State = { components: Map<string, string>; fonts: Set<string> };
const states = new WeakMap<object, State>();

export function stateOf(): State {
	const f = figmaApi();
	let state = states.get(f);
	if (state === undefined) {
		state = { components: new Map(), fonts: new Set() };
		states.set(f, state);
	}
	return state;
}

const idOf = (ref: Ref): string => (typeof ref === "string" ? ref : ref.id);
const refsOf = (what: Ref | readonly Ref[]): readonly Ref[] =>
	(Array.isArray(what) ? what : [what]) as readonly Ref[];

export function createTracker(): Tracker {
	const created = new Set<string>();
	const mutated = new Set<string>();
	const removed = new Set<string>();
	const warnings: StepWarning[] = [];
	const add =
		(into: Set<string>) =>
		<T extends Ref | readonly Ref[]>(what: T): T => {
			for (const ref of refsOf(what)) into.add(idOf(ref));
			return what;
		};
	return {
		created: add(created),
		mutated: add(mutated),
		removed: add(removed),
		warn(code, message, nodeId) {
			warnings.push({ code, message, ...(nodeId !== undefined && { nodeId }) });
		},
		done(report) {
			const result: StepResult = {
				createdNodeIds: [...created].filter((id) => !removed.has(id)),
				mutatedNodeIds: [...mutated].filter(
					(id) => !created.has(id) && !removed.has(id),
				),
			};
			if (removed.size > 0) result.removedNodeIds = [...removed];
			if (warnings.length > 0) result.warnings = [...warnings];
			if (report !== undefined) result.report = report;
			return result;
		},
	};
}

// El seguimiento del paso en curso: `kit.track()` lo abre y las piezas que crean, cambian o borran avisan aquí
const current: { tracker: Tracker | null } = { tracker: null };

export const startTracking = (): Tracker => {
	current.tracker = createTracker();
	return current.tracker;
};

export const note = Object.freeze({
	created: <T extends Ref | readonly Ref[]>(what: T): T =>
		current.tracker?.created(what) ?? what,
	mutated: <T extends Ref | readonly Ref[]>(what: T): T =>
		current.tracker?.mutated(what) ?? what,
	removed: <T extends Ref | readonly Ref[]>(what: T): T =>
		current.tracker?.removed(what) ?? what,
	warn: (code: string, message: string, nodeId?: string): void =>
		current.tracker?.warn(code, message, nodeId),
});

// Error con siguiente paso: el servidor lo convierte en un ScriptError con `next` como siguiente paso y el código
// delante del mensaje
export function fail(code: string, message: string, next: string): never {
	throw new Error(`${FAIL_MARKER}${JSON.stringify({ code, message, next })}`);
}
