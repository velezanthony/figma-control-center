// El mapeo de design-context@1 a código: puro, sin Figma ni disco. Recibe lo
// que leyó la pestaña y los datos del proyecto (sheets@1, map@1, huellas, `report.matches`) y devuelve el contexto con
//  - cada componente enlazado a su hoja (por la clave `fcc:sheet:` o, sin ella, por el nombre del set: R-1) y a su plantilla;
//  - en lo que no es una instancia, las clases que map@1 leído al revés sabe escribir y lo que se queda suelto.
// Nunca inventa: una clase solo sale si map@1, aplicado hacia delante, devuelve la misma variable.
import {
	CODE_BY,
	DESIGN_WARNING,
	type DesignComponent,
	type DesignNode,
	type DesignRead,
	type DesignValue,
	type DesignVariable,
	type DesignWarning,
} from "../design-context.ts";
import type { MapTokens } from "../map.ts";

// De una hoja de sheets@1, lo que hace falta para enlazar un componente
export type SheetRef = {
	readonly key: string;
	readonly title: string;
	readonly source?: string | undefined;
	readonly tag?: string | undefined;
};

// Una entrada de `report.matches` del último `kit/build-screen@1`
export type PaintMatch = {
	readonly node: string;
	readonly set: string;
	readonly by: string;
};

export type ToCodeInput = {
	readonly read: DesignRead;
	readonly sheets: readonly SheetRef[];
	// Sin map@1 en el proyecto no hay clases que sugerir
	readonly tokens: MapTokens | null;
	// Componente de las huellas de map@1 → su título: solo para dar candidatas, nunca un mapeo
	readonly fingerprintTitles: Readonly<Record<string, string>>;
	readonly matches: readonly PaintMatch[];
};

export type ToCodeOutput = {
	readonly nodes: readonly DesignNode[];
	readonly variables: Readonly<Record<string, DesignVariable>>;
	readonly components: Readonly<Record<string, DesignComponent>>;
	readonly warnings: readonly DesignWarning[];
};

// Como `norm` de la auditoría vieja: sin mayúsculas ni espacios
const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, "");

const COLOR_TYPE = "COLOR";
const TEXT_TYPE = "TEXT";
const CLASS_CHARS = /^[A-Za-z0-9_-]+$/;
const TEMPLATE_GROUP = /\$(\d+)/g;

// map@1 hacia delante: ¿alguna regla convierte esta clase en esa variable?
function writes(
	cls: string,
	variable: string,
	rules: MapTokens["classToVariable"],
): boolean {
	for (const rule of rules) {
		let match: RegExpExecArray | null;
		try {
			match = new RegExp(rule.from).exec(cls);
		} catch {
			continue;
		}
		if (match === null) continue;
		const got = rule.to.replace(
			TEMPLATE_GROUP,
			(_, group: string) => match[Number(group)] ?? "",
		);
		if (got === variable) return true;
	}
	return false;
}

// map@1 al revés para una variable de color: la primera clase candidata que map@1, hacia delante, devuelve a la misma
// variable. Candidatas: el nombre con «/» → «-» y, si no lleva «/», el nombre tal cual
function codeClassOf(
	variable: DesignVariable,
	tokens: MapTokens | null,
): string | undefined {
	if (tokens === null || variable.type !== COLOR_TYPE) return undefined;
	if (!tokens.collections.includes(variable.collection)) return undefined;
	const candidates = [
		variable.name.replaceAll("/", "-"),
		...(variable.name.includes("/") ? [] : [variable.name]),
	].filter((c) => CLASS_CHARS.test(c));
	return candidates.find((c) =>
		writes(c, variable.name, tokens.classToVariable),
	);
}

const isZero = (value: DesignValue): boolean =>
	"raw" in value && value.raw === 0;
const isLoose = (value: DesignValue): boolean => "raw" in value;
// Un número suelto que no es cero: el cero no hay que escribirlo
const isLooseNumber = (value: DesignValue): boolean =>
	isLoose(value) && !isZero(value);

type Role = "fill" | "text" | "stroke";

function hintsOf(
	node: DesignNode,
	variables: Readonly<Record<string, DesignVariable>>,
	tokens: MapTokens | null,
): DesignNode["hints"] {
	const classes: string[] = [];
	const unmapped: string[] = [];
	const colors = (values: readonly DesignValue[], role: Role, name: string) => {
		const prefix = tokens?.classPrefixes[role][0];
		for (const value of values) {
			if ("raw" in value) {
				if (!unmapped.includes(name)) unmapped.push(name);
			} else if ("variable" in value && prefix !== undefined) {
				const cls = variables[value.variable]?.codeClass;
				if (cls !== undefined && !classes.includes(`${prefix}${cls}`))
					classes.push(`${prefix}${cls}`);
			}
		}
	};
	colors(node.fills ?? [], node.type === TEXT_TYPE ? "text" : "fill", "fills");
	colors(node.strokes ?? [], "stroke", "strokes");
	if ((node.effects ?? []).some(isLoose)) unmapped.push("effects");
	const { layout, radius } = node;
	if (
		layout !== undefined &&
		[layout.gap, layout.counterGap].some(
			(v) => v !== undefined && isLooseNumber(v),
		)
	)
		unmapped.push("gap");
	if (layout?.padding.some(isLooseNumber) === true) unmapped.push("padding");
	if (
		radius !== undefined &&
		[radius.tl, radius.tr, radius.br, radius.bl].some(isLooseNumber)
	)
		unmapped.push("radius");
	if (node.text !== undefined && node.text.style === undefined)
		unmapped.push("text.font");
	return classes.length === 0 && unmapped.length === 0
		? undefined
		: { classes, unmapped };
}

type Linked = {
	readonly component: DesignComponent;
	readonly warning?: DesignWarning | undefined;
};

function link(
	key: string,
	component: DesignComponent,
	input: ToCodeInput,
): Linked {
	const { sheets, fingerprintTitles } = input;
	const warn = (message: string): DesignWarning => ({
		code: DESIGN_WARNING.noCodeMapping,
		message,
		component: key,
	});
	const byKey =
		component.sheet === undefined
			? undefined
			: sheets.find((s) => s.key === component.sheet);
	const wanted = norm(component.name);
	const byName =
		byKey === undefined ? sheets.filter((s) => norm(s.title) === wanted) : [];
	const sheet = byKey ?? (byName.length === 1 ? byName[0] : undefined);
	const { sheet: _stale, ...rest } = component;

	if (sheet === undefined) {
		if (byName.length > 1) {
			const candidates = byName.map((s) => s.key);
			return {
				component: { ...rest, candidates },
				warning: warn(
					`El componente «${component.name}» coincide con varias hojas (${candidates.join(", ")}): decide cuál es.`,
				),
			};
		}
		const hinted = Object.entries(fingerprintTitles)
			.filter(([, title]) => norm(title) === wanted)
			.map(([name]) => name);
		return {
			component: hinted.length > 0 ? { ...rest, candidates: hinted } : rest,
			warning: warn(
				`El componente «${component.name}» no tiene hoja en sheets@1 (ni por la clave fcc:sheet: ni por el nombre del set)${hinted.length > 0 ? `; una huella de map@1 se llama igual: ${hinted.join(", ")}` : ""}.`,
			),
		};
	}
	const by = byKey === undefined ? CODE_BY.name : CODE_BY.key;
	if (sheet.source === undefined) {
		return {
			component: { ...rest, sheet: sheet.key },
			warning: warn(
				`La hoja «${sheet.key}» de «${component.name}» no declara \`source\` en sheets@1.`,
			),
		};
	}
	return {
		component: {
			...rest,
			sheet: sheet.key,
			code: {
				source: sheet.source,
				...(sheet.tag !== undefined && { tag: sheet.tag }),
				by,
			},
		},
	};
}

export function toCode(input: ToCodeInput): ToCodeOutput {
	const { read, tokens } = input;
	const warnings: DesignWarning[] = [];
	const components: Record<string, DesignComponent> = {};
	for (const [key, component] of Object.entries(read.components)) {
		const linked = link(key, component, input);
		components[key] = linked.component;
		if (linked.warning !== undefined) warnings.push(linked.warning);
	}
	const variables: Record<string, DesignVariable> = {};
	for (const [id, variable] of Object.entries(read.variables)) {
		const codeClass = codeClassOf(variable, tokens);
		variables[id] =
			codeClass === undefined ? variable : { ...variable, codeClass };
	}
	const by = new Map(input.matches.map((m) => [m.node, m.by]));
	const nodes = read.nodes.map((node): DesignNode => {
		if (node.instance !== undefined) {
			const matched = by.get(node.id);
			return matched === undefined
				? node
				: { ...node, matched: { by: matched } };
		}
		const hints = hintsOf(node, variables, tokens);
		return hints === undefined ? node : { ...node, hints };
	});
	return { nodes, variables, components, warnings };
}
