// Comprobaciones puras de map@1 que el esquema no ve: las expresiones regulares tienen que
// compilar y no pasar de MAX_REGEX_LENGTH. Cada problema sale con su puntero JSON.
import {
	type Fingerprints,
	MAX_REGEX_LENGTH,
	type MapFile,
	type MapIssue,
} from "./map.ts";

export function mapIssues(file: MapFile): MapIssue[] {
	const issues: MapIssue[] = [];
	const regex = (pointer: string, source: string): void => {
		if (source.length > MAX_REGEX_LENGTH) {
			issues.push({
				pointer,
				message: `la expresión regular pasa de ${MAX_REGEX_LENGTH} caracteres`,
			});
			return;
		}
		try {
			new RegExp(source);
		} catch (e) {
			issues.push({
				pointer,
				message: `la expresión regular no compila (${e instanceof Error ? e.message : String(e)})`,
			});
		}
	};
	for (const [i, rule] of file.tokens.classToVariable.entries())
		regex(`/tokens/classToVariable/${i}/from`, rule.from);
	for (const [i, family] of file.fonts.families.entries())
		regex(`/fonts/families/${i}/match`, family.match);
	if (file.effects !== undefined)
		regex("/effects/classPattern", file.effects.classPattern);
	regex("/icons/pages", file.icons.pages);
	if (file.icons.glyphs !== undefined)
		regex("/icons/glyphs/classPattern", file.icons.glyphs.classPattern);
	for (const [i, pattern] of (file.components?.genericClasses ?? []).entries())
		regex(`/components/genericClasses/${i}`, pattern);
	return issues;
}

// Lo que solo se sabe con las huellas leídas: cada componente de `leaf` tiene que estar en ellas
export function fingerprintIssues(
	file: MapFile,
	fingerprints: Fingerprints,
): MapIssue[] {
	return (file.components?.leaf ?? []).flatMap((name, i) =>
		fingerprints[name] === undefined
			? [
					{
						pointer: `/components/leaf/${i}`,
						message: `el componente «${name}» no está en las huellas`,
					},
				]
			: [],
	);
}
