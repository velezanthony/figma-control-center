import { READ_KIND, STYLE_KIND } from "#domain/catalog.ts";
import { readHeader } from "./read-header.ts";

// Script interno (formato body), solo lectura: estilos locales de cada tipo con su valor corto (pinturas, tipografía,
// efectos o retículas) y sus variables ligadas. Copias planas (JSON) de lo que da Figma. Entrada (params): { kind }
export const STYLES_SCRIPT = `
${readHeader(READ_KIND.styles)}
const SOURCES = {
	${JSON.stringify(STYLE_KIND.paint)}: [() => figma.getLocalPaintStylesAsync(), (s) => s.paints],
	${JSON.stringify(STYLE_KIND.text)}: [() => figma.getLocalTextStylesAsync(), (s) => ({ fontName: s.fontName, fontSize: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textCase: s.textCase, textDecoration: s.textDecoration, paragraphSpacing: s.paragraphSpacing })],
	${JSON.stringify(STYLE_KIND.effect)}: [() => figma.getLocalEffectStylesAsync(), (s) => s.effects],
	${JSON.stringify(STYLE_KIND.grid)}: [() => figma.getLocalGridStylesAsync(), (s) => s.layoutGrids],
};
const plain = (v) => JSON.parse(JSON.stringify(v ?? {}));
const styles = [];
for (const [kind, [list, valueOf]] of Object.entries(SOURCES)) {
	if (QUERY.kind !== null && QUERY.kind !== kind) continue;
	for (const s of await list()) {
		styles.push({ id: s.id, key: s.key, name: s.name, kind, description: s.description ?? '', boundVariables: plain(s.boundVariables), value: plain(valueOf(s)) });
	}
}
return { styles };`;
