// recognize@1: el módulo del proyecto y lo que el kit le da. El servidor nunca lo ejecuta: llega
// como texto dentro del código del paso y aquí ya es un objeto con funciones.

import type { Font, PlanNode, Rgba } from "../screen/types.ts";
import type {
	ComponentNode,
	ComponentSetNode,
	InstanceNode,
	SceneNode,
	TextNode,
} from "../types.ts";

export const RECOGNIZE_CONTRACT = "recognize@1";

export type PaintTarget = "fills" | "strokes";
export type PaintKind = "fill" | "text" | "stroke" | "svg";

// Lo que da el kit a las reglas. Todo lo demás lo ven por el árbol del nodo o por el API de plugins
export type RuleCtx = {
	// Todos los textos del nodo, en orden de lectura
	allText(node: PlanNode): string[];
	// El primer svg del nodo (él mismo si lo es)
	findSvg(node: PlanNode): PlanNode | undefined;
	// El id del componente del icono con ese nombre (el que va en una propiedad INSTANCE_SWAP)
	icon(name: string): string | undefined;
	// El nombre del icono del catálogo para una clave de trazados
	iconOf(key: string): string | undefined;
	// Las raíces de la pantalla (para preparar el árbol antes de la primera regla, p. ej. deducir de qué es cada celda)
	readonly roots: readonly PlanNode[];
	// La huella que casa con ese nodo (por la que se reconocería sin regla), o null
	fingerprintOf(node: PlanNode): { key: string; title: string } | null;
	// Las props de la variante que se está pintando
	screenProps: Readonly<Record<string, string>>;
	// El set con ese nombre (los de las reglas y los de las huellas, ya cargados); undefined si no está en el archivo
	set(name: string): ComponentSetNode | undefined;
	// Pinta `node` aparte y, al acabar la pantalla, lo mete clonado en el hueco (slot) de `instance`
	defer(
		instance: InstanceNode,
		node: PlanNode,
		chain?: readonly string[],
	): Promise<void>;
	// Un relleno o borde con el color capturado: ligado a su variable si la hay (clases del nodo o de sus antecesores)
	paint(
		node: SceneNode,
		field: PaintTarget,
		color: Rgba,
		chain: readonly string[],
		kind?: PaintKind,
	): void;
	// Lo mismo sin variable: el color tal cual
	solid(node: SceneNode, field: PaintTarget, color: Rgba): void;
	// Restila un texto ya creado (el de una instancia) con la letra capturada, solo en lo que difiera
	styleLike(
		text: TextNode,
		font: Font,
		chain: readonly string[],
	): Promise<void>;
	// El estilo de texto local que corresponde a esa letra (con interlineado, interletraje y mayúsculas en las familias `strict`)
	textStyleOf(font: Font): { id: string } | undefined;
	// Si la familia CSS es monoespaciada según map@1.fonts
	isStrictFamily(font: Font): boolean;
	// Un aviso con su código (una sola vez por código y texto)
	warn(code: string, message: string, nodeId?: string): void;
	// El kit de Figma (`figma-kit@1`), el mismo que recibe el paso
	readonly kit: unknown;
};

// Qué variante del set: las props exactas, o una función sobre cada variante (nombre y props)
export type VariantWanted =
	| Readonly<Record<string, string>>
	| ((variant: {
			name: string;
			variantProperties: Readonly<Record<string, string>>;
	  }) => boolean);

export type RuleResult = {
	variant: VariantWanted;
	// Propiedades por su nombre sin sufijo: texto, booleano o el id de un componente (INSTANCE_SWAP)
	set?: Readonly<Record<string, string | boolean | undefined>>;
	after?: (instance: InstanceNode) => void | Promise<void>;
	// `none`: la regla deja la instancia como la quiere (sin ancho capturado, borde ni marco de margen);
	// `height`: solo se iguala el alto de la fila (el átomo ya trae su relleno)
	fit?: "none" | "height";
};

export type Rule = {
	match(node: PlanNode, cls: Set<string>, ctx: RuleCtx): boolean;
	props(node: PlanNode, cls: Set<string>, ctx: RuleCtx): RuleResult;
};

export type RecognizeModule = {
	contract: typeof RECOGNIZE_CONTRACT;
	rules: Readonly<Record<string, Rule>>;
	after?: Readonly<
		Record<
			string,
			(
				instance: InstanceNode,
				node: PlanNode,
				ctx: RuleCtx,
			) => void | Promise<void>
		>
	>;
};

export type CatalogSet = ComponentSetNode;
export type Variant = ComponentNode;
