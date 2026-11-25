import { otherTheme, storeTheme, type Theme } from "#web/lib/theme.ts";
import { applyStoredTheme } from "#web/lib/theme-dom.ts";

// Estado reactivo del tema actual; el HTML ya lo lleva puesto desde theme-init
export const themeState = $state<{ current: Theme }>({
	current: applyStoredTheme(),
});

export function toggleTheme(): void {
	themeState.current = otherTheme(themeState.current);
	document.documentElement.dataset["theme"] = themeState.current;
	try {
		storeTheme(localStorage, themeState.current);
	} catch {
		// sin almacenamiento
	}
}
