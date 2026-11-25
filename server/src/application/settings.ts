import type { SettingsStore } from "#application/ports/settings.ts";
import { err, ok, type Result } from "#domain/result.ts";
import {
	type SettingsError,
	type SettingView,
	settingsError,
} from "#domain/settings.ts";

const reasonOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// Guarda un ajuste solo si vale (`validate`: clave editable y valor válido) y no lo fija el entorno (que manda sobre lo
// guardado). Se guarda el valor como lo lee la configuración (`normalize`; sin ella, tal cual)
export function makeSaveSetting(deps: {
	readonly store: SettingsStore;
	readonly validate: (key: string, value: string) => string | null;
	readonly normalize?: (key: string, value: string) => string;
	// Un valor igual al de por defecto no se guarda: borra lo guardado, como restablecer
	readonly isDefault?: (key: string, value: string) => boolean;
	readonly setByEnvironment: (key: string) => boolean;
}): (key: string, value: string) => Result<void, SettingsError> {
	return (key, value) => {
		const problem = deps.validate(key, value);
		if (problem !== null) return err(settingsError("rejected", problem));
		if (deps.setByEnvironment(key)) {
			return err(
				settingsError(
					"environment",
					`«${key}» lo fija .env o el entorno del panel: para cambiarlo aquí, quítalo de allí y reinicia el panel`,
				),
			);
		}
		try {
			if (deps.isDefault?.(key, value) === true) deps.store.remove(key);
			else deps.store.set(key, deps.normalize?.(key, value) ?? value);
			return ok(undefined);
		} catch (e) {
			return err(
				settingsError(
					"unreadable",
					`no se pudo guardar el ajuste: ${reasonOf(e)}`,
				),
			);
		}
	};
}

// Restablecer: borra lo guardado de UNA clave editable (`checkKey`: null si lo es) y nada más; vuelve a su valor por
// defecto, o al del entorno si lo fija. Sin nada guardado no hace nada. Un resto de una clave que ya no es editable no se
// borra desde aquí (D-9): sigue saliendo como aviso
export function makeResetSetting(deps: {
	readonly store: SettingsStore;
	readonly checkKey: (key: string) => string | null;
}): (key: string) => Result<void, SettingsError> {
	return (key) => {
		const problem = deps.checkKey(key);
		if (problem !== null) return err(settingsError("rejected", problem));
		try {
			deps.store.remove(key);
			return ok(undefined);
		} catch (e) {
			return err(
				settingsError(
					"unreadable",
					`no se pudo restablecer el ajuste: ${reasonOf(e)}`,
				),
			);
		}
	};
}

// Restablecer todo: borra lo guardado de TODAS las claves editables (también lo que tapa el entorno, D-6) en una sola
// transacción y devuelve las que tenían algo guardado. No toca restos de claves que ya no son editables (D-9)
export function makeResetAllSettings(deps: {
	readonly store: SettingsStore;
	readonly editableKeys: readonly string[];
}): () => Result<readonly string[], SettingsError> {
	return () => {
		try {
			return ok(deps.store.removeMany(deps.editableKeys));
		} catch (e) {
			return err(
				settingsError(
					"unreadable",
					`no se pudieron restablecer los ajustes: ${reasonOf(e)}`,
				),
			);
		}
	};
}

export type SettingsListing = {
	readonly settings: readonly SettingView[];
	// Ajustes guardados que no valen (clave desconocida, de arranque o valor inválido): no se aplican
	readonly problems: readonly string[];
};

// Cada ajuste editable con lo guardado, el valor efectivo y su origen. Lee la base en cada llamada
export function makeListSettings(deps: {
	readonly store: SettingsStore;
	readonly describe: (
		stored: Readonly<Record<string, string>>,
	) => readonly SettingView[];
	readonly problems: (
		stored: Readonly<Record<string, string>>,
	) => readonly string[];
}): () => Result<SettingsListing, SettingsError> {
	return () => {
		try {
			const stored = deps.store.all();
			return ok({
				settings: deps.describe(stored),
				problems: deps.problems(stored),
			});
		} catch (e) {
			return err(
				settingsError(
					"unreadable",
					`no se pudieron leer los ajustes: ${reasonOf(e)}`,
				),
			);
		}
	};
}
