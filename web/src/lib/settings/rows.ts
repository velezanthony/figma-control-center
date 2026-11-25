import type {
	SettingOrigin,
	SettingUser,
	SettingValue,
	SettingView,
} from "#web/lib/contract.ts";

export const ORIGIN_LABEL = {
	default: "Por defecto",
	panel: "Guardado en el panel",
	env: "Fijado en el entorno",
} as const satisfies Record<SettingOrigin, string>;

export type RowState = {
	// Lo fija el entorno: no se edita (el entorno manda y un cambio no se aplicaría)
	readonly readOnly: boolean;
	// Hay algo guardado que borrar
	readonly canReset: boolean;
	// A qué valor vuelve al restablecer: el del entorno si lo fija, si no el valor por defecto
	readonly resetsTo: string;
	// Lo guardado que no se aplica (lo tapa el entorno o no vale), o null
	readonly ignoredStored: string | null;
	// Por qué no vale lo guardado (el aviso del servidor), o null
	readonly storedProblem: string | null;
	// Lo usa el panel y este arrancó con otro valor: hasta reiniciarlo no se aplica (D-2)
	readonly pendingRestart: boolean;
};

// El aviso del servidor sobre lo guardado de una clave (los avisos la nombran entre «»), o null
export const storedProblem = (
	key: string,
	problems: readonly string[],
): string | null => problems.find((p) => p.includes(`«${key}»`)) ?? null;

// «Guardar» solo cuando lo escrito difiere del valor efectivo (tras recortar espacios): sin cambio no hay nada que guardar
export const hasChanged = (draft: string, effective: SettingValue): boolean =>
	draft.trim() !== String(effective);

// Los ajustes con algo guardado: lo que «Restablecer todo» devolvería a su valor por defecto (también lo que tapa el
// entorno o no vale, como hace el servidor)
export const storedSettings = (
	settings: readonly SettingView[],
): readonly SettingView[] => settings.filter((s) => s.stored !== null);

export function rowState(
	setting: SettingView,
	problem: string | null,
): RowState {
	const readOnly = setting.origin === "env";
	// Guardado y aplicado solo cuando el origen es el panel: con otro origen, lo guardado no cuenta
	const ignoredStored =
		setting.stored !== null && setting.origin !== "panel"
			? setting.stored
			: null;
	return {
		readOnly,
		canReset: setting.stored !== null,
		resetsTo: String(readOnly ? setting.effective : setting.default),
		ignoredStored,
		storedProblem: ignoredStored === null ? null : problem,
		pendingRestart:
			setting.usedBy.includes("panel") && setting.running !== setting.effective,
	};
}

const APPLIES: Record<SettingUser, string> = {
	agent: "al próximo agente que lances",
	panel: "al reiniciar el panel",
};
const USER_ORDER: readonly SettingUser[] = ["agent", "panel"];

// Para quién vale un cambio y cuándo: nada se recarga en caliente (D-1, D-2)
export const appliesWhen = (usedBy: readonly SettingUser[]): string =>
	`Se aplica ${USER_ORDER.filter((u) => usedBy.includes(u))
		.map((u) => APPLIES[u])
		.join(" y ")}`;

// Escalas para leer en humano un valor en ms o en bytes: de mayor a menor, la primera que quepa
const SCALES: Record<string, readonly (readonly [number, string])[]> = {
	ms: [
		[3_600_000, "h"],
		[60_000, "min"],
		[1000, "s"],
	],
	bytes: [
		[1_000_000, "MB"],
		[1000, "kB"],
	],
};
const DECIMALS = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });
const INTEGER = /^\s*\d+\s*$/;

// La unidad del campo y, si es ms o bytes y llega a la escala siguiente, el valor en humano: «ms · 5 min» (D-4)
export function unitLabel(value: string, unit: string): string {
	const scales = SCALES[unit];
	if (scales === undefined || !INTEGER.test(value)) return unit;
	const n = Number(value);
	const scale = scales.find(([size]) => n >= size);
	return scale === undefined
		? unit
		: `${unit} · ${DECIMALS.format(n / scale[0])} ${scale[1]}`;
}

export type SettingGroup = {
	readonly group: string;
	readonly settings: readonly SettingView[];
};

// Una tarjeta por grupo, en el orden en que llegan (el del servidor): un grupo nuevo sale sin tocar la web (D-8)
export function groupSettings(
	settings: readonly SettingView[],
): readonly SettingGroup[] {
	const groups = new Map<string, SettingView[]>();
	for (const s of settings) {
		groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
	}
	return [...groups].map(([group, list]) => ({ group, settings: list }));
}
