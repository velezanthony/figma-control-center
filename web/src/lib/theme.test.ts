import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	DEFAULT_THEME,
	otherTheme,
	readStoredTheme,
	storeTheme,
	THEME,
	THEME_STORAGE_KEY,
} from "./theme.ts";

const storageWith = (value: string | null) => ({ getItem: () => value });

describe("tema", () => {
	it("por defecto es el claro", () => {
		assert.equal(DEFAULT_THEME, THEME.light);
		assert.equal(readStoredTheme(storageWith(null)), THEME.light);
	});

	it("recupera el tema guardado y descarta valores ajenos", () => {
		assert.equal(readStoredTheme(storageWith("dark")), THEME.dark);
		assert.equal(readStoredTheme(storageWith("rosa")), THEME.light);
	});

	it("si el almacenamiento falla usa el de por defecto en vez de romper", () => {
		const broken = {
			getItem: () => {
				throw new Error("bloqueado");
			},
		};
		assert.equal(readStoredTheme(broken), THEME.light);
		assert.doesNotThrow(() =>
			storeTheme(
				{
					setItem: () => {
						throw new Error("bloqueado");
					},
				},
				THEME.light,
			),
		);
	});

	it("guarda el tema bajo su clave", () => {
		const saved: string[][] = [];
		storeTheme({ setItem: (k, v) => saved.push([k, v]) }, THEME.light);
		assert.deepEqual(saved, [[THEME_STORAGE_KEY, "light"]]);
	});

	it("otherTheme alterna", () => {
		assert.equal(otherTheme(THEME.dark), THEME.light);
		assert.equal(otherTheme(THEME.light), THEME.dark);
	});
});
