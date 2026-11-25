import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	readCollapsed,
	SIDEBAR_STORAGE_KEY,
	storeCollapsed,
} from "./sidebar-state.ts";

describe("estado de la sidebar", () => {
	it("por defecto está desplegada y recupera lo guardado", () => {
		assert.equal(readCollapsed({ getItem: () => null }), false);
		assert.equal(readCollapsed({ getItem: () => "1" }), true);
		assert.equal(readCollapsed({ getItem: () => "otra cosa" }), false);
	});

	it("si el almacenamiento falla no rompe", () => {
		const broken = {
			getItem: () => {
				throw new Error("bloqueado");
			},
			setItem: () => {
				throw new Error("bloqueado");
			},
		};
		assert.equal(readCollapsed(broken), false);
		assert.doesNotThrow(() => storeCollapsed(broken, true));
	});

	it("guarda bajo su clave", () => {
		const saved: string[][] = [];
		storeCollapsed({ setItem: (k, v) => saved.push([k, v]) }, true);
		assert.deepEqual(saved, [[SIDEBAR_STORAGE_KEY, "1"]]);
	});
});
