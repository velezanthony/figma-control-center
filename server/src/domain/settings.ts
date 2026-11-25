// Ajustes del panel: las variables de configuración que se pueden cambiar desde la base.
// Contrato compartido SIN imports. Precedencia: valor por defecto < ajuste guardado (panel) < entorno (.env).

// De dónde sale el valor efectivo de un ajuste
export type SettingOrigin = "default" | "panel" | "env";

// Qué proceso lee un ajuste (al arrancar): el panel, el agente (y cualquier sesión de Claude Code) o los dos
export type SettingUser = "panel" | "agent";

// La ficha de un ajuste: con ella la pantalla pinta una clave que no conoce
export type SettingInfo = {
	readonly group: string;
	readonly name: string;
	readonly help: string;
	// La unidad en la que se escribe el valor (ms, bytes, días…)
	readonly unit: string;
	readonly usedBy: readonly SettingUser[];
};

export type SettingValue = string | number | boolean;

export type SettingView = SettingInfo & {
	readonly key: string;
	// Lo que hay guardado en la base (aunque no valga o lo tape el entorno), o null si no hay nada
	readonly stored: string | null;
	// El valor con el que corre el programa que arranque ahora
	readonly effective: SettingValue;
	readonly origin: SettingOrigin;
	readonly default: SettingValue;
	// Con qué valor arrancó el panel que responde (lo guardado cuando arrancó): si difiere de `effective`, falta reiniciarlo
	readonly running: SettingValue;
};

export type SettingsError = {
	readonly type: "SettingsError";
	// rejected: la clave o el valor no valen; environment: lo fija el entorno (manda sobre lo guardado, así que guardarlo
	// no cambiaría nada); unreadable: no se pudo leer o escribir la base
	readonly reason: "rejected" | "environment" | "unreadable";
	readonly message: string;
};

export const settingsError = (
	reason: SettingsError["reason"],
	message: string,
): SettingsError => ({ type: "SettingsError", reason, message });

// Modo del panel (FCC_DASHBOARD_MODE): en desarrollo enseña además la galería de componentes, que solo sirve para
// construir el propio panel
export const DASHBOARD_MODE = {
	production: "production",
	development: "development",
} as const;
export type DashboardMode =
	(typeof DASHBOARD_MODE)[keyof typeof DASHBOARD_MODE];
