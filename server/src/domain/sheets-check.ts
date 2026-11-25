// Comprobaciones puras de sheets@1 que el esquema no ve: claves repetidas, el cruce con
// screens@1 y los nombres de propiedad repetidos. Cada problema sale con su puntero JSON. Los avisos (lo que no impide
// pintar) van aparte.
import type { ScreensFile } from "./capture.ts";
import type { SheetsFile, SheetsIssue } from "./sheets.ts";

const propsOf = (screens: ScreensFile, key: string): Set<string> | null => {
	const screen = screens.screens.find((s) => s.key === key);
	if (screen === undefined) return null;
	return new Set((screen.variants ?? []).flatMap((v) => Object.keys(v.props)));
};

export function sheetsIssues(
	file: SheetsFile,
	screens: ScreensFile,
): SheetsIssue[] {
	const issues: SheetsIssue[] = [];
	const add = (pointer: string, message: string) =>
		issues.push({ pointer, message });
	const keys = new Set<string>();
	for (const [i, sheet] of file.sheets.entries()) {
		const at = `/sheets/${i}`;
		if (keys.has(sheet.key))
			add(`${at}/key`, `la hoja «${sheet.key}» está repetida`);
		keys.add(sheet.key);

		const props = propsOf(screens, sheet.screen);
		if (props === null) {
			add(`${at}/screen`, `la pantalla «${sheet.screen}» no está en screens@1`);
		} else {
			for (const [j, row] of (sheet.matrix?.rows ?? []).entries())
				if (!props.has(row))
					add(
						`${at}/matrix/rows/${j}`,
						`ninguna variante de «${sheet.screen}» tiene la propiedad «${row}»`,
					);
			for (const [j, icon] of (sheet.icons ?? []).entries())
				for (const prop of Object.keys(icon.noBooleanWhen ?? {}))
					if (!props.has(prop))
						add(
							`${at}/icons/${j}/noBooleanWhen/${prop}`,
							`ninguna variante de «${sheet.screen}» tiene la propiedad «${prop}»`,
						);
		}

		// `map` añade valores para props que SOLO tiene Figma: una prop que la web ya trae no se puede mapear
		if (props !== null && sheet.drift?.decision === "map")
			for (const prop of Object.keys(sheet.drift.values))
				if (props.has(prop))
					add(
						`${at}/drift/values/${prop}`,
						`«${prop}» ya es una propiedad de las variantes de «${sheet.screen}»: \`map\` solo añade valores a las props que únicamente tiene Figma`,
					);

		// Un nombre de propiedad vale para un solo grupo; dos iconos sí pueden compartir su booleano o su intercambio
		const owner = new Map<string, string>();
		const claim = (name: string, group: string, pointer: string) => {
			const prev = owner.get(name);
			if (prev !== undefined && (prev !== group || group !== "icons"))
				add(pointer, `la propiedad «${name}» está repetida (ya es de ${prev})`);
			else owner.set(name, group);
		};
		for (const [j, t] of (sheet.texts ?? []).entries())
			claim(t.name, "texts", `${at}/texts/${j}/name`);
		for (const [j, b] of (sheet.booleans ?? []).entries())
			claim(b.name, "booleans", `${at}/booleans/${j}/name`);
		for (const [j, icon] of (sheet.icons ?? []).entries()) {
			if (icon.boolean !== undefined)
				claim(icon.boolean, "icons", `${at}/icons/${j}/boolean`);
			if (icon.swap !== undefined)
				claim(icon.swap, "icons", `${at}/icons/${j}/swap`);
		}
		for (const [j, s] of (sheet.slots ?? []).entries()) {
			claim(s.name, "slots", `${at}/slots/${j}/name`);
			if (s.boolean !== undefined)
				claim(s.boolean, "slots", `${at}/slots/${j}/boolean`);
		}
	}
	return issues;
}

// Una regla que `recognize.js` no nombra: aviso, no error (el módulo es texto y el servidor no lo ejecuta)
export function sheetsWarnings(
	file: SheetsFile,
	options: { readonly recognizeSource: string | null },
): SheetsIssue[] {
	const source = options.recognizeSource;
	if (source === null) return [];
	return file.sheets.flatMap((sheet, i) =>
		(sheet.rules ?? []).flatMap((rule, j) =>
			source.includes(rule)
				? []
				: [
						{
							pointer: `/sheets/${i}/rules/${j}`,
							message: `recognize.js no nombra el set «${rule}»`,
						},
					],
		),
	);
}
