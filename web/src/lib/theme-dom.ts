import { DEFAULT_THEME, readStoredTheme, type Theme } from "#web/lib/theme.ts";

export function applyStoredTheme(): Theme {
	let theme: Theme = DEFAULT_THEME;
	try {
		theme = readStoredTheme(localStorage);
	} catch {
		// acceder a localStorage también puede lanzar
	}
	document.documentElement.dataset["theme"] = theme;
	return theme;
}
