export const THEME = Object.freeze({ dark: "dark", light: "light" } as const);
export type Theme = (typeof THEME)[keyof typeof THEME];

export const DEFAULT_THEME: Theme = THEME.light;
export const THEME_STORAGE_KEY = "figma-control-center-theme";

export const isTheme = (value: unknown): value is Theme =>
	value === THEME.dark || value === THEME.light;

export const otherTheme = (theme: Theme): Theme =>
	theme === THEME.dark ? THEME.light : THEME.dark;

// El almacenamiento puede no existir (ventana privada, datos bloqueados): la página funciona igual
export function readStoredTheme(storage: Pick<Storage, "getItem">): Theme {
	try {
		const stored = storage.getItem(THEME_STORAGE_KEY);
		return isTheme(stored) ? stored : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

export function storeTheme(
	storage: Pick<Storage, "setItem">,
	theme: Theme,
): void {
	try {
		storage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// sin almacenamiento: el tema solo dura esta visita
	}
}
