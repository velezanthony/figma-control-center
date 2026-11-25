// Variables por nombre del ÚNICO modo de cada colección (plan de Figma con un modo). Si una colección trae más, se usa
// el de por defecto y se avisa: nunca se crean modos
import { fail, figmaApi, note } from "./core.ts";
import type { Variable } from "./types.ts";

// Un color sale como RGBA ({ r, g, b, a }), como lo da Figma, aunque se guardara como RGB
export type TokenValue = unknown;

export type TokenEntry = {
	readonly name: string;
	readonly collection: string;
	readonly variable: Variable;
	readonly value: TokenValue;
};

export type Tokens = {
	readonly collections: readonly string[];
	variable(name: string): Variable | undefined;
	value(name: string): TokenValue;
	names(): string[];
	// Cada variable una sola vez, en el orden de sus colecciones
	entries(): TokenEntry[];
};

const MAX_ALIAS_DEPTH = 10;

export async function loadTokens(names?: readonly string[]): Promise<Tokens> {
	const f = figmaApi();
	const all = await f.variables.getLocalVariableCollectionsAsync();
	const chosen =
		names === undefined
			? all
			: names.map((name) => all.find((c) => c.name === name));
	const missing = names?.filter((_, i) => chosen[i] === undefined) ?? [];
	if (missing.length > 0) {
		fail(
			"COLLECTION_NOT_FOUND",
			`No hay colecciones de variables llamadas ${missing.map((m) => `«${m}»`).join(", ")}.`,
			"Mira las colecciones con figma_variables y corrige el nombre.",
		);
	}
	const modeOf = new Map(all.map((c) => [c.id, c.defaultModeId]));
	const variables = new Map<string, Variable>();
	const values = new Map<string, TokenValue>();
	const entries: TokenEntry[] = [];

	const resolve = async (
		variable: Variable,
		modeId: string,
	): Promise<TokenValue> => {
		let current: Variable = variable;
		let mode = modeId;
		for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
			const raw = current.valuesByMode[mode];
			const alias = raw as { type?: string; id?: string } | undefined;
			if (alias?.type !== "VARIABLE_ALIAS" || alias.id === undefined)
				return raw;
			const target = await f.variables.getVariableByIdAsync(alias.id);
			if (target === null) return undefined;
			current = target;
			mode = modeOf.get(target.variableCollectionId) ?? mode;
		}
		return undefined;
	};

	for (const collection of chosen) {
		if (collection === undefined) continue;
		if (collection.modes.length > 1) {
			note.warn(
				"MULTI_MODE",
				`La colección «${collection.name}» tiene ${collection.modes.length} modos; se lee el de por defecto.`,
			);
		}
		for (const id of collection.variableIds) {
			const variable = await f.variables.getVariableByIdAsync(id);
			if (variable === null) continue;
			const value = await resolve(variable, collection.defaultModeId);
			entries.push({
				name: variable.name,
				collection: collection.name,
				variable,
				value,
			});
			for (const name of [
				variable.name,
				`${collection.name}/${variable.name}`,
			]) {
				if (!variables.has(name)) {
					variables.set(name, variable);
					values.set(name, value);
				}
			}
		}
	}
	return Object.freeze({
		collections: chosen.flatMap((c) => (c === undefined ? [] : [c.name])),
		variable: (name: string) => variables.get(name),
		value: (name: string) => values.get(name),
		names: () => [...variables.keys()],
		entries: () => [...entries],
	});
}
