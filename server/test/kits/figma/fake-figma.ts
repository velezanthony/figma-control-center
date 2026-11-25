// Doble mínimo del API de plugins de Figma, en Node, para probar las piezas del kit.
// REPRODUCE A PROPÓSITO cada trampa del API de plugins que el kit resuelve. Si Figma cambia una trampa este doble sigue igual: la prueba de verdad es
// `make kit-contract` contra el archivo de pruebas.

type Rec = Record<string, unknown>;
type Rect = { x: number; y: number; width: number; height: number };
type FontName = { family: string; style: string };
type PropDef = {
	type: string;
	defaultValue?: string | boolean;
	// Solo en las de tipo VARIANT: los valores que admite (como en Figma real)
	variantOptions?: string[];
	// Solo en las INSTANCE_SWAP: los componentes que Figma ofrece primero
	preferredValues?: { type: string; key: string }[];
};

type TextRange = {
	start: number;
	end: number;
	fontName: FontName;
	fontSize: number;
	fills: unknown[];
	textDecoration: string;
};

export type Stats = { findAll: number; reactionWrites: number };

// Propiedades de disposición: el valor de un enum fuera de lista o un número que no es número lanzan, como en Figma
// (algunas propiedades lanzan según el tipo de nodo)
const LAYOUT_ENUMS: Readonly<Record<string, readonly string[]>> = {
	layoutMode: ["NONE", "HORIZONTAL", "VERTICAL"],
	primaryAxisSizingMode: ["FIXED", "AUTO"],
	counterAxisSizingMode: ["FIXED", "AUTO"],
	primaryAxisAlignItems: ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"],
	counterAxisAlignItems: ["MIN", "CENTER", "MAX", "BASELINE"],
	layoutAlign: ["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"],
	layoutPositioning: ["AUTO", "ABSOLUTE"],
	overflowDirection: ["NONE", "HORIZONTAL", "VERTICAL", "BOTH"],
	layoutSizingHorizontal: ["FIXED", "HUG", "FILL"],
	layoutSizingVertical: ["FIXED", "HUG", "FILL"],
	layoutWrap: ["NO_WRAP", "WRAP"],
};
const LAYOUT_DEFAULTS: Readonly<Record<string, string | number | boolean>> = {
	layoutMode: "NONE",
	primaryAxisSizingMode: "FIXED",
	counterAxisSizingMode: "FIXED",
	primaryAxisAlignItems: "MIN",
	counterAxisAlignItems: "MIN",
	layoutAlign: "INHERIT",
	layoutPositioning: "AUTO",
	overflowDirection: "NONE",
	layoutSizingHorizontal: "FIXED",
	layoutSizingVertical: "FIXED",
	layoutWrap: "NO_WRAP",
	counterAxisSpacing: 0,
	strokesIncludedInLayout: false,
	layoutGrow: 0,
	itemSpacing: 0,
	paddingTop: 0,
	paddingRight: 0,
	paddingBottom: 0,
	paddingLeft: 0,
	clipsContent: false,
	x: 0,
	y: 0,
	strokeTopWeight: 0,
	strokeRightWeight: 0,
	strokeBottomWeight: 0,
	strokeLeftWeight: 0,
};

const fontKey = (f: FontName): string => `${f.family}/${f.style}`;

const f32 = (v: Rec): Rec => ({
	...v,
	...(typeof v["value"] === "number" && { value: Math.fround(v["value"]) }),
});

function strictKeys(value: object, allowed: string[], where: string): void {
	const extra = Object.keys(value).filter((k) => !allowed.includes(k));
	if (extra.length > 0)
		throw new Error(`in ${where}: Unrecognized key: "${extra[0]}"`);
}

// Medido en el archivo de pruebas (2026-11-12): un FontName lleva solo `family` y `style`; una clave de más lanza («Unrecognized key»)
function strictFontName(font: object, where: string): void {
	const extra = Object.keys(font).filter(
		(k) => k !== "family" && k !== "style",
	);
	if (extra.length > 0)
		throw new Error(
			`in ${where}: Property failed validation: Unrecognized key: "${extra[0]}"`,
		);
}

// Cabecera de una imagen: PNG, JPEG o GIF y su tamaño (lo que `createImage` acepta; Figma real: tope de 4096 por lado)
export function readImageInfo(
	bytes: Uint8Array,
): { type: "png" | "jpeg" | "gif"; width: number; height: number } | null {
	const u16 = (i: number) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
	const u32 = (i: number) => (u16(i) * 65536 + u16(i + 2)) >>> 0;
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
		return { type: "png", width: u32(16), height: u32(20) };
	}
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		const le = (i: number) => (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8);
		return { type: "gif", width: le(6), height: le(8) };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		for (let i = 2; i + 9 < bytes.length; ) {
			if (bytes[i] !== 0xff) return null;
			const marker = bytes[i + 1] ?? 0;
			if (marker >= 0xc0 && marker <= 0xc3) {
				return { type: "jpeg", height: u16(i + 5), width: u16(i + 7) };
			}
			i += 2 + u16(i + 2);
		}
	}
	return null;
}

export class FakeNode {
	id: string;
	type: string;
	name: string;
	parent: FakeNode | null = null;
	children: FakeNode[] = [];
	removed = false;
	#visible = true;
	// Medido (archivo de pruebas, 2026-11-12): un `visible` que llega por una referencia de propiedad (valor por defecto falso) oculta
	// la capa pero Figma NO recalcula siempre el ancho del marco que se ajusta al contenido (variantes de un set con 216: unas
	// quedan con el ancho de «todo visible»); asignar `visible` directamente a una capa sí lo recalcula
	get visible(): boolean {
		return this.#visible;
	}

	set visible(value: boolean) {
		this.#visible = value;
		if (this.#ownerInstance() !== null) this.#overridden.add("visible");
		// asignar `visible` directamente sí recalcula el ancho
		if (this.parent) this.parent.#stale = null;
	}

	// El ancho que guarda Figma de un marco que se ajusta al contenido cuando una referencia de propiedad ocultó una capa sin
	// recalcularlo
	#stale: number | null = null;

	#hugs(): boolean {
		return (
			this.doc.hugLayout &&
			this.layoutMode === "HORIZONTAL" &&
			this.primaryAxisSizingMode === "AUTO"
		);
	}

	#contentWidth(): number {
		const kids = this.children.filter(
			(c) => c.visible && c.layoutPositioning !== "ABSOLUTE",
		);
		return (
			this.paddingLeft +
			this.paddingRight +
			kids.reduce((sum, c) => sum + c.width, 0) +
			this.itemSpacing * Math.max(0, kids.length - 1)
		);
	}
	#fills: unknown[] = [];
	strokes: unknown[] = [];
	#refs: Rec | null = null;
	// Sin verificar (H8, lo cierra `make kit-contract`): una capa DENTRO de una instancia no admite referencias de propiedad
	// fuera de eso, un campo de referencia desconocido lanza
	get componentPropertyReferences(): Rec | null {
		return this.#refs;
	}

	set componentPropertyReferences(value: Rec | null) {
		if (value !== null) {
			strictKeys(
				value,
				["characters", "visible", "mainComponent", "slotContentId"],
				"set_componentPropertyReferences",
			);
			if (this.#ownerInstance() !== null)
				throw new Error(
					"Cannot set component property references on instance sublayer",
				);
		}
		this.#refs = value;
		this.#touch();
		const key = value?.["visible"];
		if (typeof key === "string" && this.doc.hugLayout) {
			let owner: FakeNode | null = this.parent;
			while (owner && owner.type !== "COMPONENT_SET") owner = owner.parent;
			if (owner?.componentPropertyDefinitions[key]?.defaultValue === false) {
				if (this.parent) this.parent.#stale ??= this.parent.width;
				this.#visible = false;
			}
		}
	}
	// Lo que cambió en esta capa una instancia que la lleva dentro (`overrides` de la instancia)
	#overridden = new Set<string>();
	// Las instancias vivas de este componente y los valores que cada una puso por propiedad (H2, medido: al vaciar y rellenar
	// una variante, sus instancias siguen apuntando a ella, conservan lo puesto por propiedad y pierden lo directo en subcapas)
	#instances = new Set<FakeNode>();
	#explicit = new Map<string, string | boolean>();
	// Lo que la instancia metió en cada hueco, por la clave del hueco: sobrevive a que el hueco se quite y se cree de nuevo
	#slotMemory = new Map<string, FakeNode[]>();
	componentPropertyDefinitions: Record<string, PropDef> = {};
	componentProperties: Record<
		string,
		{ type: string; value: string | boolean }
	> = {};
	variantProperties: Record<string, string> | null = null;
	main: FakeNode | null = null;
	// Una instancia con texto editado a mano (.characters)
	edited = false;
	// «Inexistente»: capas de una instancia editada movida a un SLOT
	broken = false;
	#fontName: FontName | symbol = { family: "Inter", style: "Regular" };
	// Tramos puestos a mano por un test (los de `setRange*` salen de `#ranges`)
	segments: { fontName: FontName }[] = [];
	declare layoutMode: string;
	declare primaryAxisSizingMode: string;
	declare counterAxisSizingMode: string;
	declare primaryAxisAlignItems: string;
	declare counterAxisAlignItems: string;
	declare layoutAlign: string;
	declare layoutPositioning: string;
	declare overflowDirection: string;
	declare layoutSizingHorizontal: string;
	declare layoutSizingVertical: string;
	declare layoutWrap: string;
	declare counterAxisSpacing: number;
	declare strokesIncludedInLayout: boolean;
	declare layoutGrow: number;
	declare itemSpacing: number;
	declare paddingTop: number;
	declare paddingRight: number;
	declare paddingBottom: number;
	declare paddingLeft: number;
	declare clipsContent: boolean;
	declare x: number;
	declare y: number;
	declare strokeTopWeight: number;
	declare strokeRightWeight: number;
	declare strokeBottomWeight: number;
	declare strokeLeftWeight: number;
	minHeight: number | null = null;
	#width = 100;
	description = "";
	readonly shared = new Map<string, string>();
	#characters = "";
	#height = 100;
	#fixed = 0;
	#reactions: Rec[] = [];
	#flowPoints: { nodeId: string; name: string }[] = [];
	readonly #layout: Record<string, string | number | boolean> = {
		...LAYOUT_DEFAULTS,
	};

	readonly doc: FakeFigma;

	constructor(doc: FakeFigma, type: string, name: string) {
		this.doc = doc;
		this.id = `${++doc.counter}:${doc.counter}`;
		this.type = type;
		this.name = name;
		doc.all.set(this.id, this);
		for (const key of Object.keys(LAYOUT_DEFAULTS)) {
			Object.defineProperty(this, key, {
				get: () => {
					if (key === "x") return this.flowX() ?? this.#layout[key];
					if (key === "y") return this.flowY() ?? this.#layout[key];
					return this.#layout[key];
				},
				set: (value: unknown) => {
					this.#checkChildProp(key, value);
					const allowed = LAYOUT_ENUMS[key];
					const wanted = LAYOUT_DEFAULTS[key];
					if (allowed !== undefined) {
						if (typeof value !== "string" || !allowed.includes(value))
							throw new Error(`Invalid value for ${key}: ${String(value)}`);
					} else if (typeof wanted === "number") {
						if (typeof value !== "number" || Number.isNaN(value))
							throw new Error(
								`Expected number for ${key}, got ${typeof value}`,
							);
					} else if (typeof value !== "boolean") {
						throw new Error(`Expected boolean for ${key}`);
					}
					this.#layout[key] = value as string | number | boolean;
					// Figma real: un marco que pasa a auto-layout nace ajustándose al contenido en los dos ejes
					if (key === "layoutMode" && value !== "NONE" && this.doc.hugLayout) {
						this.#layout["primaryAxisSizingMode"] = "AUTO";
						this.#layout["counterAxisSizingMode"] = "AUTO";
					}
				},
				enumerable: true,
				configurable: true,
			});
		}
	}

	get width(): number {
		const text = this.textBox();
		if (text !== null) return text.w;
		if (this.#hugs()) return this.#stale ?? this.#contentWidth();
		return this.#width;
	}

	set width(value: number) {
		this.#width = value;
	}

	// El alto de un marco con auto-layout que se ajusta al contenido lo da el contenido, con el mínimo de `minHeight`
	get height(): number {
		const text = this.textBox();
		if (text !== null) return text.h;
		const huggingHeight =
			(this.layoutMode === "HORIZONTAL" &&
				this.counterAxisSizingMode === "AUTO") ||
			(this.layoutMode === "VERTICAL" && this.primaryAxisSizingMode === "AUTO");
		if (!huggingHeight) return this.#height;
		const inFlow = this.children.filter(
			(c) => c.layoutPositioning !== "ABSOLUTE",
		);
		const heights = inFlow.map((c) => c.height);
		const content =
			this.layoutMode === "HORIZONTAL"
				? Math.max(0, ...heights)
				: heights.reduce((a, b) => a + b, 0) +
					this.itemSpacing * Math.max(0, heights.length - 1);
		return Math.max(
			content + this.paddingTop + this.paddingBottom,
			this.minHeight ?? 0,
		);
	}

	set height(value: number) {
		this.#height = value;
	}

	// Caja absoluta: x e y se suman hacia arriba hasta la página; null si el nodo no cuelga de ninguna
	get absoluteBoundingBox(): Rect | null {
		let x = 0;
		let y = 0;
		for (let n: FakeNode | null = this; n !== null; n = n.parent) {
			if (n.type === "PAGE")
				return { x, y, width: this.width, height: this.height };
			x += n.x;
			y += n.y;
		}
		return null;
	}

	// Trampa 5 (sin verificar: la cierra `make kit-contract`): null en lo oculto y en un texto vacío; `renderBounds` fija
	// lo que pintan los glifos cuando un test quiere que no coincida con la caja
	renderBounds: Rect | null | undefined = undefined;
	get absoluteRenderBounds(): Rect | null {
		if (this.renderBounds !== undefined) return this.renderBounds;
		if (this.type === "TEXT" && this.#characters === "") return null;
		for (let n: FakeNode | null = this; n !== null; n = n.parent)
			if (!n.visible) return null;
		return this.absoluteBoundingBox;
	}

	// Figma real: los hijos fijos son los últimos de la lista. Asignar más de los que hay lanza
	// Medido en el archivo de pruebas (2026-11-15): el valor se guarda tal cual, pero en un marco con auto-layout solo cuentan los
	// últimos hijos que están fuera del flujo (ABSOLUTE); se lee el menor de los dos y se recalcula al cambiar los hijos o su
	// posicionamiento (un hijo en flujo al final lo deja en 0; volver a ponerlo ABSOLUTE lo recupera)
	get numberOfFixedChildren(): number {
		if (this.layoutMode === "NONE") return this.#fixed;
		let absolute = 0;
		for (const child of [...this.children].reverse()) {
			if (child.layoutPositioning !== "ABSOLUTE") break;
			absolute += 1;
		}
		return Math.min(this.#fixed, absolute);
	}

	set numberOfFixedChildren(value: number) {
		if (value > this.children.length) {
			throw new Error(
				`Failed to set numberOfFixedChildren: ${value} > ${this.children.length} children`,
			);
		}
		this.#fixed = value;
	}

	get fixedChildren(): FakeNode[] {
		const fixed = this.numberOfFixedChildren;
		return fixed === 0 ? [] : this.children.slice(-fixed);
	}

	// Las reacciones salen como las devuelve Figma: la duración en coma flotante de 32 bits (medido para la opacidad;
	// sin verificar para la duración: lo cierra `make kit-contract`)
	get reactions(): Rec[] {
		return this.#reactions.map((r) => {
			const copy = structuredClone(r) as { actions?: Rec[] };
			for (const action of copy.actions ?? []) {
				const transition = action["transition"] as
					| { duration?: number }
					| undefined;
				if (transition?.duration !== undefined)
					transition.duration = Math.fround(transition.duration);
			}
			return copy as Rec;
		});
	}

	// Un clic a un frame de OTRA página lanza (trampa 3; sin verificar: el kit quita las reacciones antes de mover a otra
	// página, sin causa medida — lo cierra `make kit-contract`)
	async setReactionsAsync(reactions: Rec[]): Promise<void> {
		for (const [index, reaction] of reactions.entries()) {
			for (const action of (reaction["actions"] as Rec[] | undefined) ?? []) {
				const destination = action["destinationId"];
				if (typeof destination !== "string") continue;
				const target = this.doc.all.get(destination);
				if (target === undefined || target.removed)
					throw new Error(`Destination ${destination} does not exist`);
				if (target.page() !== this.page())
					throw new Error("Cannot navigate to a node on another page");
				// Medido en el archivo de pruebas (2026-11-15): un cambio de variante solo vale en una instancia de su set; en un marco o en
				// una instancia de otro set Figma lo rechaza lanzando un texto, no un Error («Uncaught (in promise)» en el lote). En
				// una capa de dentro de una instancia, sin verificar: manda la instancia que la contiene
				if (
					action["navigation"] === "CHANGE_TO" &&
					!this.#ownSet()?.children.includes(target)
				)
					throw `Reaction at index ${index} was invalid (destination ${destination} was rejected — the destination node may not exist, the source may not be a valid prototype source, or the destination may not be a valid destination for this source)`;
			}
		}
		this.doc.stats.reactionWrites += 1;
		this.#reactions = structuredClone(reactions);
	}

	get flowStartingPoints(): { nodeId: string; name: string }[] {
		return this.#flowPoints.map((p) => ({ ...p }));
	}

	// Se asigna entera: una lista corta borra los demás puntos
	set flowStartingPoints(points: { nodeId: string; name: string }[]) {
		if (this.type !== "PAGE")
			throw new Error("flowStartingPoints is only available on pages");
		// Medido en Figma real: dos puntos con el mismo nodeId lanzan
		if (new Set(points.map((p) => p.nodeId)).size !== points.length)
			throw new Error(
				"in set_flowStartingPoints: Found duplicate input nodeIds",
			);
		this.#flowPoints = points.map((p) => ({ ...p }));
	}

	// La página que contiene al nodo (null si no cuelga de ninguna)
	page(): FakeNode | null {
		for (let n: FakeNode | null = this; n !== null; n = n.parent) {
			if (n.type === "PAGE") return n;
		}
		return null;
	}

	// El set de la instancia (o variante) que contiene al nodo, o él mismo: donde un cambio de variante puede ir
	#ownSet(): FakeNode | null {
		for (let n: FakeNode | null = this; n !== null; n = n.parent) {
			const main =
				n.type === "INSTANCE" ? n.main : n.type === "COMPONENT" ? n : null;
			if (main === null) continue;
			return main.parent?.type === "COMPONENT_SET" ? main.parent : main;
		}
		return null;
	}

	// Pone ids nuevos al nodo y a lo que lleva dentro (Figma real: los ids cambian)
	renumber(): void {
		for (const n of [this, ...this.descendants()]) {
			this.doc.all.delete(n.id);
			n.id = `${++this.doc.counter}:${this.doc.counter}`;
			this.doc.all.set(n.id, n);
		}
	}

	// `M x y x2 y2` (lineto implícito) no se acepta
	set vectorPaths(paths: { data: string }[]) {
		for (const p of paths) {
			if (/M\s*-?[\d.]+\s+-?[\d.]+\s+-?[\d.]/.test(p.data)) {
				throw new Error("Invalid vectorPaths: implicit lineto after M");
			}
		}
		this.#paths = paths;
	}

	get vectorPaths(): { data: string }[] {
		return this.#paths;
	}

	#paths: { data: string }[] = [];

	// Medido en Figma real (make kit-contract, 2026-11-12): al asignar una pintura recién ligada a una variable de color,
	// Figma le pone la opacidad a 1; una pintura que ya estaba ligada a esa variable conserva la suya
	set fills(paints: unknown[]) {
		const bound = (p: unknown) =>
			(p as { boundVariables?: { color?: { id: string } } }).boundVariables
				?.color?.id;
		const before = new Set(
			this.#fills.map(bound).filter((id) => id !== undefined),
		);
		this.#fills = paints.map((p) => {
			const id = bound(p);
			return id !== undefined && !before.has(id)
				? { ...(p as object), opacity: 1 }
				: p;
		});
	}

	get fills(): unknown[] {
		return this.#fills;
	}

	get characters(): string {
		return this.#characters;
	}

	// Escribir `characters` con la fuente sin cargar lanza (figma-use: gotchas del API de plugins)
	set characters(value: string) {
		const font = this.#fontName as FontName;
		if (!this.doc.loadedFonts.has(`${font.family}/${font.style}`)) {
			throw new Error(
				`Cannot write to node with unloaded font "${font.family} ${font.style}"`,
			);
		}
		this.#characters = value;
		if (this.#ownerInstance() !== null) this.#overridden.add("characters");
		this.#ranges = [
			{
				start: 0,
				end: value.length,
				fontName: this.#fontName as FontName,
				fontSize: this.#fontSize,
				fills: [...this.#fills],
				textDecoration: this.#textDecoration,
			},
		];
	}

	// Para montar el árbol de un test sin pasar por la regla de la fuente
	seedCharacters(value: string): this {
		this.#characters = value;
		return this;
	}

	// el `figma` de la página no tiene id de plugin
	setPluginData(): never {
		throw new Error("Cannot set private plugin data in a plugin without an ID");
	}

	setSharedPluginData(ns: string, key: string, value: string): void {
		this.shared.set(`${ns}\u0000${key}`, value);
	}

	getSharedPluginData(ns: string, key: string): string {
		return this.shared.get(`${ns}\u0000${key}`) ?? "";
	}

	async loadAsync(): Promise<void> {}

	resize(w: number, h: number): void {
		this.#width = w;
		this.#height = h;
	}

	appendChild(child: FakeNode): void {
		this.insertChild(
			this.children.length - (child.parent === this ? 1 : 0),
			child,
		);
	}

	insertChild(index: number, child: FakeNode): void {
		const fromPage = child.parent === null ? null : child.page();
		// Sin verificar (trampa 3): mover a otra página algo con enlaces a lo que se queda lanza
		const crossesPages =
			child.type !== "PAGE" && fromPage !== null && fromPage !== this.page();
		if (crossesPages) {
			const moving = new Set([child, ...child.descendants()]);
			for (const node of moving) {
				for (const reaction of node.reactions) {
					for (const action of (reaction["actions"] as Rec[] | undefined) ??
						[]) {
						// Medido en el archivo de pruebas (2026-11-15): una instancia con el cambio de variante de su componente (hover) se
						// mueve de página sin problema
						if (action["navigation"] === "CHANGE_TO") continue;
						const target = this.doc.all.get(String(action["destinationId"]));
						if (target !== undefined && !moving.has(target))
							throw new Error("Cannot move a node with links to another page");
					}
				}
			}
		}
		const from = child.parent;
		child.parent?.children.splice(child.parent.children.indexOf(child), 1);
		child.parent = this;
		this.children.splice(index, 0, child);
		if (this.type === "COMPONENT_SET" && child.type === "COMPONENT")
			this.#adoptVariant(child);
		if (this.doc.hugLayout) this.#stretchInto(child);
		if (from !== null && from !== this) from.#touch();
		this.#touch();
		// Medido en Figma real (trampa 2, make kit-contract 2026-11-12): mover un nodo a otra página conserva su id y el de lo
		// que lleva dentro
		// una instancia con texto editado movida a un SLOT deja sus subcapas «inexistentes»
		if (this.type === "SLOT" && child.edited) child.markBroken();
	}

	// Medido en el archivo de pruebas (2026-11-15): un marco que se ajusta al contenido en el eje cruzado del padre y cuyos hijos lo
	// rellenan todos en ese eje, si entra con layoutAlign STRETCH, toma el tamaño que el padre tenga en ese momento (los 100 de
	// un marco recién creado) y se queda fijo en ese eje. Sin hijos que lo rellenen, conserva su tamaño
	#stretchInto(child: FakeNode): void {
		if (
			this.layoutMode === "NONE" ||
			child.layoutMode === "NONE" ||
			child.layoutAlign !== "STRETCH"
		)
			return;
		const vertical = this.layoutMode === "HORIZONTAL";
		const along = (child.layoutMode === "HORIZONTAL") === vertical;
		const sizing = along ? "counterAxisSizingMode" : "primaryAxisSizingMode";
		if (child[sizing] !== "AUTO") return;
		const flow = child.children.filter(
			(c) => c.layoutPositioning !== "ABSOLUTE",
		);
		const fills = (c: FakeNode) =>
			along ? c.layoutAlign === "STRETCH" : c.layoutGrow === 1;
		if (flow.length === 0 || !flow.every(fills)) return;
		child[sizing] = "FIXED";
		if (vertical) child.#height = this.#height;
		else child.#width = this.#width;
	}

	markBroken(): void {
		this.broken = true;
		for (const c of this.children) c.markBroken();
	}

	remove(): void {
		// la página abierta no se puede borrar
		if (this.type === "PAGE" && this.doc.currentPage === this) {
			throw new Error("Cannot remove the current page");
		}
		this.removed = true;
		const was = this.parent;
		if (this.parent)
			this.parent.children.splice(this.parent.children.indexOf(this), 1);
		this.parent = null;
		for (const c of this.descendants()) c.removed = true;
		if (was !== null) was.#touch();
		// Medido en Figma real (trampa 13): las instancias de un componente quitado siguen apuntando a él (getMainComponentAsync
		// no da null)
	}

	// El componente (variante) del que cuelga este nodo sin pasar por una instancia
	#componentOf(): FakeNode | null {
		for (let n: FakeNode | null = this; n !== null; n = n.parent) {
			if (n.type === "INSTANCE") return null;
			if (n.type === "COMPONENT") return n;
		}
		return null;
	}

	#touch(): void {
		const component = this.#componentOf();
		if (component !== null) component.#resync();
	}

	// H6 (medido): `set.appendChild(componente)` añade una variante que lee sus props del nombre, en 0,0, y el set apunta sus opciones
	#adoptVariant(child: FakeNode): void {
		const props: Record<string, string> = {};
		for (const part of child.name.split(",")) {
			const [k, v] = part.split("=");
			if (k !== undefined && v !== undefined) props[k.trim()] = v.trim();
		}
		if (Object.keys(props).length === 0) return;
		child.variantProperties = props;
		child.x = 0;
		child.y = 0;
		for (const [name, value] of Object.entries(props)) {
			const def = this.componentPropertyDefinitions[name] ?? {
				type: "VARIANT",
				defaultValue: value,
				variantOptions: [],
			};
			if (!def.variantOptions?.includes(value)) def.variantOptions?.push(value);
			this.componentPropertyDefinitions[name] = def;
		}
	}

	// Las instancias se rehacen desde la variante; lo puesto por propiedad se vuelve a aplicar y lo que la instancia metió en un
	// hueco sigue ahí mientras el hueco conserve su clave (H11, medido)
	#resync(): void {
		for (const inst of this.#instances) {
			if (inst.removed) continue;
			for (const slot of inst.descendants()) {
				const slotKey = slot.componentPropertyReferences?.["slotContentId"];
				if (slot.type !== "SLOT" || typeof slotKey !== "string") continue;
				inst.#slotMemory.set(slotKey, [...slot.children]);
				slot.children = [];
			}
			for (const old of inst.children) {
				old.removed = true;
				for (const d of old.descendants()) d.removed = true;
			}
			inst.children = [];
			for (const child of this.children) {
				const copy = child.#copy(false);
				copy.parent = inst;
				inst.children.push(copy);
			}
			for (const [key, def] of Object.entries(this.#defs())) {
				inst.componentProperties[key] ??= {
					type: def.type,
					value: def.defaultValue ?? "",
				};
			}
			for (const slot of inst.descendants()) {
				const slotKey = slot.componentPropertyReferences?.["slotContentId"];
				if (slot.type !== "SLOT" || typeof slotKey !== "string") continue;
				for (const kept of inst.#slotMemory.get(slotKey) ?? []) {
					kept.parent = slot;
					slot.children.push(kept);
				}
			}
			for (const [key, value] of inst.#explicit) inst.#reapply(key, value);
		}
	}

	#reapply(key: string, value: string | boolean): void {
		const prop = this.componentProperties[key];
		if (prop === undefined) return;
		prop.value = value;
		for (const d of this.descendants()) {
			const refs = d.componentPropertyReferences;
			if (!refs || d.#ownerInstance() !== this) continue;
			if (refs["characters"] === key) {
				d.seedCharacters(String(value));
				d.#overridden.add("characters");
			}
			if (refs["visible"] === key) d.visible = Boolean(value);
		}
	}

	// `overrides` de una instancia: las capas de dentro con algo cambiado en la instancia. Sin verificar contra Figma real:
	// la lista de verdad no se limpia sola al repintar la variante (H2, medido: la entrada de la subcapa vieja sigue)
	get overrides(): { id: string; overriddenFields: string[] }[] {
		if (this.type !== "INSTANCE")
			throw new Error("`overrides` solo existe en una instancia");
		return [
			...this.descendants()
				.filter((n) => n.#overridden.size > 0)
				.map((n) => ({ id: n.id, overriddenFields: [...n.#overridden] })),
			...this.#staleOverrides,
		];
	}

	// Medido en el archivo de pruebas (2026-11-15): un campo que la instancia cambió y el doble no marca solo (fills, strokes, name,
	// styledTextSegments… salen en `overrides` junto a characters, visible y componentProperties)
	markOverridden(field: string): void {
		this.#overridden.add(field);
	}

	// Medido (lote 6, 2026-11-14): `overrides` puede traer entradas cuyo id ya no es de ninguna capa de la instancia (la de
	// otra variante, antes de cambiarla): getNodeByIdAsync da null
	#staleOverrides: { id: string; overriddenFields: string[] }[] = [];
	staleOverride(id: string, fields: string[]): void {
		this.#staleOverrides.push({ id, overriddenFields: fields });
	}

	// Las instancias vivas de un componente (de todas sus variantes, si es un set)
	async getInstancesAsync(): Promise<FakeNode[]> {
		const targets = this.type === "COMPONENT_SET" ? this.children : [this];
		return [...this.doc.all.values()].filter(
			(n) =>
				n.type === "INSTANCE" &&
				!n.removed &&
				n.main !== null &&
				targets.includes(n.main),
		);
	}

	descendants(): FakeNode[] {
		return this.children.flatMap((c) => [c, ...c.descendants()]);
	}

	// Una capa «inexistente» hace reventar cualquier recorrido
	#walk(): FakeNode[] {
		const all = this.descendants();
		const bad = all.find((n) => n.broken);
		if (bad) throw new Error(`Node ${bad.id} does not exist`);
		return all;
	}

	findAll(cb: (n: FakeNode) => boolean): FakeNode[] {
		this.doc.stats.findAll += 1;
		return this.#walk().filter(cb);
	}

	findOne(cb: (n: FakeNode) => boolean): FakeNode | null {
		return this.findAll(cb)[0] ?? null;
	}

	findAllWithCriteria(criteria: {
		types?: string[];
		sharedPluginData?: { namespace: string; keys?: string[] };
	}): FakeNode[] {
		return this.#walk().filter((n) => {
			if (criteria.types && !criteria.types.includes(n.type)) return false;
			const spd = criteria.sharedPluginData;
			if (spd) {
				const keys = spd.keys ?? [];
				if (!keys.some((k) => n.shared.has(`${spd.namespace}\u0000${k}`)))
					return false;
			}
			return true;
		});
	}

	// tras clone() de una variante, las referencias a propiedades se pierden. Los demás nodos las conservan
	clone(): FakeNode {
		const copy = this.#copy(this.type === "COMPONENT");
		this.doc.currentPage.appendChild(copy);
		return copy;
	}

	#copy(dropRefs: boolean): FakeNode {
		const c = new FakeNode(this.doc, this.type, this.name);
		c.#visible = this.#visible;
		c.#fills = [...this.#fills];
		c.strokes = structuredClone(this.strokes);
		c.#fontName = this.#fontName;
		c.#fontSize = this.#fontSize;
		c.#ranges = this.#ranges.map((r) => ({ ...r }));
		c.measured = this.measured;
		c.#characters = this.#characters;
		c.variantProperties = this.variantProperties && {
			...this.variantProperties,
		};
		c.componentPropertyDefinitions = structuredClone(
			this.componentPropertyDefinitions,
		);
		c.componentProperties = structuredClone(this.componentProperties);
		c.main = this.main;
		c.width = this.width;
		c.#height = this.#height;
		Object.assign(c.#layout, this.#layout);
		c.componentPropertyReferences =
			dropRefs || this.componentPropertyReferences === null
				? null
				: { ...this.componentPropertyReferences };
		for (const [k, v] of this.shared) c.shared.set(k, v);
		for (const child of this.children) {
			const cc = child.#copy(dropRefs);
			cc.parent = c;
			c.children.push(cc);
		}
		return c;
	}

	// --- texto, aspecto y estilos ---
	// Las trampas MEDIDAS están en el resto del doble. Lo que sigue es «sin verificar: lo cierra
	// `make kit-contract`» y hace lo más duro posible: si Figma real hace otra cosa, este doble cambia con el hallazgo.
	opacity = 1;
	strokeAlign = "CENTER";
	effects: Rec[] = [];
	effectStyleId = "";
	textStyleId = "";
	// Lo que lee design-context@1: estilos de relleno y de borde, límites de tamaño y si el
	// componente viene de otra librería. Sin verificar contra Figma real salvo lo ya medido
	fillStyleId = "";
	strokeStyleId = "";
	remote = false;
	minWidth: number | null = null;
	maxWidth: number | null = null;
	maxHeight: number | null = null;
	constraints: { horizontal: string; vertical: string } = {
		horizontal: "MIN",
		vertical: "MIN",
	};
	boundVariables: Record<string, { type: string; id: string }> = {};
	// El texto lo mide el doble solo en los nodos que crea `createText` (los de `fake.text` conservan sus 100 x 100)
	measured = false;
	#fontSize = 12;
	#lineHeight: Rec = { unit: "AUTO" };
	#letterSpacing: Rec = { unit: "PIXELS", value: 0 };
	#textCase = "ORIGINAL";
	#textDecoration = "NONE";
	#textAlign = "LEFT";
	#autoResize = "NONE";
	#maxLines: number | null = null;
	#truncation = "DISABLED";
	#radii = [0, 0, 0, 0];
	#scroll = "SCROLLS";
	#ranges: TextRange[] = [];

	// Trampa 13 (medida en el archivo de pruebas, 2026-11-12): el tamaño FILL de un hijo de un marco SIN auto-layout lanza («node must be an auto-layout frame or a child of an auto-layout frame»); layoutGrow y layoutAlign NO lanzan. Trampa 15
	// (sin verificar): `layoutPositioning = "ABSOLUTE"` solo vale dentro de auto-layout
	#checkChildProp(key: string, value: unknown): void {
		const childKeys = [
			"layoutSizingHorizontal",
			"layoutSizingVertical",
			"layoutPositioning",
		];
		if (
			!this.doc.strictLayout ||
			!childKeys.includes(key) ||
			this.parent === null
		)
			return;
		if (this.parent.type === "PAGE" || this.parent.type === "DOCUMENT") return;
		if (this.parent.layoutMode !== "NONE") return;
		const isDefault = value === LAYOUT_DEFAULTS[key] || value === "INHERIT";
		if (!isDefault)
			throw new Error(
				`Cannot set ${key} on a child of a frame without auto-layout`,
			);
	}

	get fontName(): FontName | symbol {
		const names = new Set(this.#ranges.map((r) => fontKey(r.fontName)));
		if (names.size > 1) return this.doc.mixed;
		return this.#fontName;
	}

	set fontName(value: FontName | symbol) {
		if (typeof value !== "symbol") this.#needFont(value);
		this.#fontName = value;
		if (typeof value !== "symbol")
			for (const r of this.#ranges) r.fontName = value;
	}

	#needFont(font: FontName): void {
		strictFontName(font, "fontName");
		if (this.doc.strictText && !this.doc.loadedFonts.has(fontKey(font)))
			throw new Error(
				`Cannot use unloaded font "${font.family} ${font.style}"`,
			);
	}

	get fontSize(): number {
		return this.#fontSize;
	}

	// Medido (2026-11-12): fontSize, lineHeight e letterSpacing vuelven en 32 bits y tocarlos desengancha el estilo de texto
	set fontSize(value: number) {
		this.#fontSize = Math.fround(value);
		this.#detach();
		for (const r of this.#ranges) r.fontSize = value;
	}

	// Trampa 10 (sin verificar): tocar interlineado, interletraje o mayúsculas desliga el estilo de texto
	#detach(): void {
		this.textStyleId = "";
	}

	get lineHeight(): Rec {
		return { ...this.#lineHeight };
	}

	set lineHeight(value: Rec) {
		strictKeys(value, ["unit", "value"], "lineHeight");
		this.#lineHeight = f32(value);
		this.#detach();
	}

	get letterSpacing(): Rec {
		return { ...this.#letterSpacing };
	}

	set letterSpacing(value: Rec) {
		strictKeys(value, ["unit", "value"], "letterSpacing");
		this.#letterSpacing = f32(value);
		this.#detach();
	}

	get textCase(): string {
		return this.#textCase;
	}

	set textCase(value: string) {
		this.#textCase = value;
		this.#detach();
	}

	get textDecoration(): string {
		return this.#textDecoration;
	}

	set textDecoration(value: string) {
		this.#textDecoration = value;
		for (const r of this.#ranges) r.textDecoration = value;
	}

	get textAlignHorizontal(): string {
		return this.#textAlign;
	}

	set textAlignHorizontal(value: string) {
		if (!["LEFT", "CENTER", "RIGHT", "JUSTIFIED"].includes(value))
			throw new Error(`Invalid textAlignHorizontal ${value}`);
		this.#textAlign = value;
	}

	get textAutoResize(): string {
		return this.#autoResize;
	}

	set textAutoResize(value: string) {
		if (!["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"].includes(value))
			throw new Error(`Invalid textAutoResize ${value}`);
		this.#autoResize = value;
	}

	// Trampa 22 (sin verificar): una línea con puntos exige `maxLines = 1` y `textTruncation = "ENDING"`
	get maxLines(): number | null {
		return this.#maxLines;
	}

	set maxLines(value: number | null) {
		this.#maxLines = value;
	}

	get textTruncation(): string {
		return this.#truncation;
	}

	set textTruncation(value: string) {
		if (!["DISABLED", "ENDING"].includes(value))
			throw new Error(`Invalid textTruncation ${value}`);
		this.#truncation = value;
	}

	// Un texto medido: ~0,6 del tamaño por carácter y el alto de línea (o 1,2 del tamaño). WIDTH_AND_HEIGHT crece a lo
	// ancho; HEIGHT mantiene el ancho y reparte en líneas
	textBox(): { w: number; h: number } | null {
		if (!this.measured) return null;
		const lh =
			this.#lineHeight["unit"] === "PIXELS"
				? Number(this.#lineHeight["value"])
				: this.#fontSize * 1.2;
		const own = this.#characters.split("\n");
		const natural =
			Math.max(...own.map((l) => l.length)) * this.#fontSize * 0.6;
		if (this.#autoResize === "WIDTH_AND_HEIGHT")
			return { w: natural, h: own.length * lh };
		if (this.#autoResize === "HEIGHT") {
			const w = this.#width;
			const lines = own.reduce(
				(sum, l) =>
					sum + Math.max(1, Math.ceil((l.length * this.#fontSize * 0.6) / w)),
				0,
			);
			return { w, h: lines * lh };
		}
		return null;
	}

	// Un marco con auto-layout opt-in (`fake.autoLayout`): sin más motor que apilar los hijos en el flujo, dejando
	// `itemSpacing` y el relleno; lo bastante para medir huecos entre hermanos
	#flowPosition(axis: "x" | "y"): number | undefined {
		const p = this.parent;
		if (
			!this.doc.autoLayout ||
			p === null ||
			p.type === "PAGE" ||
			p.layoutMode === "NONE" ||
			this.layoutPositioning === "ABSOLUTE"
		)
			return undefined;
		const horizontal = p.layoutMode === "HORIZONTAL";
		const flow = p.children.filter((c) => c.layoutPositioning !== "ABSOLUTE");
		const index = flow.indexOf(this);
		const main = axis === (horizontal ? "x" : "y");
		if (!main) return axis === "x" ? p.paddingLeft : p.paddingTop;
		let at = horizontal ? p.paddingLeft : p.paddingTop;
		for (const c of flow.slice(0, index))
			at += (horizontal ? c.width : c.height) + p.itemSpacing;
		return at;
	}

	flowX(): number | undefined {
		return this.#flowPosition("x");
	}

	flowY(): number | undefined {
		return this.#flowPosition("y");
	}

	get cornerRadius(): number | symbol {
		return this.#radii.every((r) => r === this.#radii[0])
			? (this.#radii[0] ?? 0)
			: this.doc.mixed;
	}

	set cornerRadius(value: number | symbol) {
		if (typeof value === "number") this.#radii = [value, value, value, value];
	}

	get topLeftRadius(): number {
		return this.#radii[0] ?? 0;
	}
	set topLeftRadius(v: number) {
		this.#radii[0] = v;
	}
	get topRightRadius(): number {
		return this.#radii[1] ?? 0;
	}
	set topRightRadius(v: number) {
		this.#radii[1] = v;
	}
	get bottomRightRadius(): number {
		return this.#radii[2] ?? 0;
	}
	set bottomRightRadius(v: number) {
		this.#radii[2] = v;
	}
	get bottomLeftRadius(): number {
		return this.#radii[3] ?? 0;
	}
	set bottomLeftRadius(v: number) {
		this.#radii[3] = v;
	}

	get strokeWeight(): number | symbol {
		const w = [
			this.strokeTopWeight,
			this.strokeRightWeight,
			this.strokeBottomWeight,
			this.strokeLeftWeight,
		];
		return w.every((x) => x === w[0]) ? (w[0] ?? 0) : this.doc.mixed;
	}

	set strokeWeight(value: number | symbol) {
		if (typeof value !== "number") return;
		this.strokeTopWeight = value;
		this.strokeRightWeight = value;
		this.strokeBottomWeight = value;
		this.strokeLeftWeight = value;
	}

	// Trampa 14 (sin verificar): `scrollBehavior` se asigna sin error pero NO se conserva en un hijo de un marco con
	// auto-layout
	get scrollBehavior(): string {
		return this.#scroll;
	}

	set scrollBehavior(value: string) {
		if (!["SCROLLS", "FIXED", "STICKY_SCROLLS"].includes(value))
			throw new Error(`Invalid scrollBehavior ${value}`);
		if (this.parent !== null && this.parent.layoutMode !== "NONE") return;
		this.#scroll = value;
	}

	// Trampa 17 (sin verificar): ligar una variable numérica pone su valor en el campo
	setBoundVariable(field: string, variable: { id: string } | null): void {
		if (variable === null) {
			delete this.boundVariables[field];
			return;
		}
		const v = this.doc.variableList.get(variable.id);
		if (v === undefined)
			throw new Error(`No existe la variable ${variable.id}`);
		const raw = Object.values(v.valuesByMode)[0];
		if (typeof raw === "number")
			(this as unknown as Record<string, unknown>)[field] = raw;
		this.boundVariables[field] = { type: "VARIABLE_ALIAS", id: variable.id };
	}

	rescale(factor: number): void {
		this.width = this.width * factor;
		this.height = this.height * factor;
	}

	async setTextStyleIdAsync(id: string): Promise<void> {
		if (id === "") {
			this.textStyleId = "";
			return;
		}
		const style = this.doc.textStyles.find((x) => x.id === id);
		if (style === undefined) throw new Error(`No existe el estilo ${id}`);
		this.#needFont(style.fontName);
		this.#fontName = style.fontName;
		this.#fontSize = style.fontSize;
		this.#lineHeight = { ...style.lineHeight };
		this.#letterSpacing = { ...style.letterSpacing };
		this.#textCase = style.textCase;
		this.textStyleId = id;
	}

	async setEffectStyleIdAsync(id: string): Promise<void> {
		const style = this.doc.effectStyles.find((x) => x.id === id);
		if (style === undefined) throw new Error(`No existe el estilo ${id}`);
		this.effects = structuredClone(style.effects);
		this.effectStyleId = id;
	}

	// Estilos por tramos (trampa 12, sin verificar con el kit): se parten los tramos y cada uno guarda lo suyo
	#range(start: number, end: number, apply: (r: TextRange) => void): void {
		if (end > this.#characters.length || start < 0 || start >= end)
			throw new Error(`Range ${start}-${end} out of bounds`);
		const next: TextRange[] = [];
		for (const r of this.#ranges) {
			if (r.end <= start || r.start >= end) {
				next.push(r);
				continue;
			}
			if (r.start < start) next.push({ ...r, end: start });
			const inside = {
				...r,
				start: Math.max(r.start, start),
				end: Math.min(r.end, end),
			};
			apply(inside);
			next.push(inside);
			if (r.end > end) next.push({ ...r, start: end });
		}
		this.#ranges = next;
	}

	setRangeFontName(start: number, end: number, font: FontName): void {
		this.#needFont(font);
		this.#range(start, end, (r) => {
			r.fontName = font;
		});
	}
	setRangeFontSize(start: number, end: number, size: number): void {
		this.#range(start, end, (r) => {
			r.fontSize = size;
		});
	}
	setRangeFills(start: number, end: number, fills: unknown[]): void {
		this.#range(start, end, (r) => {
			r.fills = fills;
		});
	}
	setRangeTextDecoration(start: number, end: number, value: string): void {
		this.#range(start, end, (r) => {
			r.textDecoration = value;
		});
	}

	// La variante por defecto de un set (la primera, como en el doble de `componentSet`)
	get defaultVariant(): FakeNode | null {
		if (this.type !== "COMPONENT_SET")
			throw new Error("defaultVariant solo existe en un set de componentes");
		return this.children[0] ?? null;
	}

	// La clave de un componente (la de `preferredValues`): estable mientras el componente exista
	get key(): string {
		return `k${this.id.replace(":", "_")}`;
	}

	// --- hojas de componentes ---
	#exposed = false;
	// Sin verificar (H10): solo una instancia se expone, y se relee igual
	get isExposedInstance(): boolean {
		return this.#exposed;
	}

	set isExposedInstance(value: boolean) {
		if (this.type !== "INSTANCE")
			throw new Error("isExposedInstance solo existe en una instancia");
		// Medido (H10, archivo de pruebas 2026-11-12): solo se expone una instancia con instancias anidadas expuestas o con hijos que
		// llevan referencias de propiedad
		if (
			value &&
			!this.descendants().some(
				(d) => d.#exposed || d.componentPropertyReferences !== null,
			)
		)
			throw new Error(
				"in set_isExposedInstance: Can only expose instances that have exposed nested instances or children with component property references",
			);
		this.#exposed = value;
	}

	#dash: number[] = [];
	// Los números vuelven en 32 bits (medido); los guiones se leen igual de largos
	get dashPattern(): number[] {
		return [...this.#dash];
	}

	set dashPattern(value: number[]) {
		if (!Array.isArray(value) || value.some((v) => typeof v !== "number"))
			throw new Error("Expected an array of numbers for dashPattern");
		this.#dash = value.map(Math.fround);
	}

	// Sin verificar (H13): cambia el tamaño sin tocar a los hijos y el set no se reajusta solo al mover una variante
	resizeWithoutConstraints(w: number, h: number): void {
		if (w < 0.01 || h < 0.01)
			throw new Error("Size must be at least 0.01 in resizeWithoutConstraints");
		this.#width = w;
		this.#height = h;
	}

	// Una copia con otro id y lo mismo dentro (lo que hace `combineAsVariants` con cada componente, H7), que conserva las
	// referencias de propiedad: a diferencia de `clone()`, no se cuelga de la página
	reidentify(): FakeNode {
		return this.#copy(false);
	}

	// Lo que un nodo nuevo hereda del que sustituye (`createComponentFromNode` conserva la disposición, H1)
	adoptStyleFrom(node: FakeNode): void {
		Object.assign(this.#layout, node.#layout);
		this.#fills = [...node.#fills];
		this.strokes = structuredClone(node.strokes);
		this.#dash = [...node.#dash];
		this.#radii = [...node.#radii];
		this.boundVariables = structuredClone(node.boundVariables);
		this.opacity = node.opacity;
		this.effects = structuredClone(node.effects);
		this.strokeAlign = node.strokeAlign;
	}

	// --- componentes ---
	#defs(): Record<string, PropDef> {
		return this.type === "COMPONENT" && this.parent?.type === "COMPONENT_SET"
			? this.parent.componentPropertyDefinitions
			: this.componentPropertyDefinitions;
	}

	// Medido: un INSTANCE_SWAP lleva el id de un componente que existe. Sin verificar (H4 y H9, lo cierra
	// `make kit-contract`): un nombre que ya existe lanza; `preferredValues` es una lista de { type, key } sin claves de más
	addComponentProperty(
		name: string,
		type: string,
		defaultValue?: string | boolean,
		options?: { preferredValues?: { type: string; key: string }[] },
	): string {
		if (options !== undefined) {
			strictKeys(options, ["preferredValues"], "addComponentProperty");
			if (type !== "INSTANCE_SWAP" && options.preferredValues !== undefined)
				throw new Error("preferredValues solo vale en un INSTANCE_SWAP");
			for (const p of options.preferredValues ?? []) {
				strictKeys(p, ["type", "key"], "preferredValues");
				if (p.type !== "COMPONENT" && p.type !== "COMPONENT_SET")
					throw new Error(`Invalid preferred value type: ${p.type}`);
			}
		}
		if (
			this.doc.strictProperties &&
			this.type === "COMPONENT" &&
			this.parent?.type === "COMPONENT_SET"
		)
			throw new Error("Can't add properties to a variant: add them to its set");
		if (!this.doc.strictProperties)
			return this.#addProperty(name, type, defaultValue, options);
		// Medido (H4, archivo de pruebas 2026-11-12): un nombre que ya existe no lanza; Figma crea otra propiedad con el nombre y un 2
		const taken = (n: string) =>
			Object.keys(this.componentPropertyDefinitions).some(
				(k) => k.split("#")[0] === n,
			);
		let unique = name;
		for (let n = 2; taken(unique); n++) unique = `${name}${n}`;
		if (type === "INSTANCE_SWAP") {
			const target =
				typeof defaultValue === "string"
					? (this.doc.all.get(defaultValue) ?? null)
					: null;
			if (target === null || target.removed || target.type !== "COMPONENT")
				throw new Error(
					"Default value for instance swap component property is invalid",
				);
		}
		return this.#addProperty(unique, type, defaultValue, options);
	}

	#addProperty(
		name: string,
		type: string,
		defaultValue?: string | boolean,
		options?: { preferredValues?: { type: string; key: string }[] },
	): string {
		const key = `${name}#${++this.doc.counter}:0`;
		this.componentPropertyDefinitions[key] = {
			type,
			...(defaultValue !== undefined && { defaultValue }),
			...(options?.preferredValues !== undefined && {
				preferredValues: structuredClone(options.preferredValues),
			}),
		};
		return key;
	}

	deleteComponentProperty(key: string): void {
		delete this.componentPropertyDefinitions[key];
	}

	// Medido (H3, archivo de pruebas 2026-11-12): cambiar el valor por defecto o los preferidos conserva la clave `nombre#id` y no
	// pisa el valor que una instancia ya puso
	editComponentProperty(
		key: string,
		change: {
			name?: string;
			defaultValue?: string | boolean;
			preferredValues?: { type: string; key: string }[];
		},
	): string {
		strictKeys(
			change,
			["name", "defaultValue", "preferredValues"],
			"editComponentProperty",
		);
		const def = this.componentPropertyDefinitions[key];
		if (!def) throw new Error(`No existe la propiedad ${key}`);
		if (change.defaultValue !== undefined) {
			if (def.type === "INSTANCE_SWAP") {
				const target =
					typeof change.defaultValue === "string"
						? (this.doc.all.get(change.defaultValue) ?? null)
						: null;
				if (target === null || target.removed || target.type !== "COMPONENT")
					throw new Error(
						"Default value for instance swap component property is invalid",
					);
			}
			def.defaultValue = change.defaultValue;
		}
		if (change.preferredValues !== undefined) {
			for (const p of change.preferredValues)
				strictKeys(p, ["type", "key"], "preferredValues");
			def.preferredValues = structuredClone(change.preferredValues);
		}
		if (change.name === undefined) return key;
		const next = `${change.name}#${key.split("#")[1]}`;
		delete this.componentPropertyDefinitions[key];
		this.componentPropertyDefinitions[next] = def;
		for (const n of this.descendants()) {
			const refs = n.componentPropertyReferences;
			if (refs)
				for (const f of Object.keys(refs)) if (refs[f] === key) refs[f] = next;
			// Medido (archivo de pruebas, 2026-11-12): al renombrar una propiedad SLOT, Figma renombra el nodo SLOT que la usa
			if (n.type === "SLOT" && refs?.["slotContentId"] === next)
				n.name = change.name;
		}
		return next;
	}

	createSlot(): FakeNode {
		const slot = new FakeNode(this.doc, "SLOT", "Slot");
		const key =
			this.parent?.type === "COMPONENT_SET"
				? this.parent.addComponentProperty("Slot", "SLOT")
				: this.addComponentProperty("Slot", "SLOT");
		slot.componentPropertyReferences = { slotContentId: key };
		this.appendChild(slot);
		return slot;
	}

	createInstance(): FakeNode {
		const inst = new FakeNode(this.doc, "INSTANCE", this.name);
		inst.main = this;
		// Medido en el archivo de pruebas (2026-11-15): la instancia lee las reacciones de su variante (el hover de un botón)
		inst.#reactions = structuredClone(this.#reactions);
		this.#instances.add(inst);
		// Una instancia nace con el tamaño de su componente
		inst.width = this.width;
		inst.height = this.height;
		// Medido en Figma real (2026-11-12): una instancia refleja el sharedPluginData de su componente principal
		for (const [k, v] of this.shared) inst.shared.set(k, v);
		const defs = this.#defs();
		for (const [key, def] of Object.entries(defs)) {
			inst.componentProperties[key] = {
				type: def.type,
				value: def.defaultValue ?? "",
			};
		}
		for (const child of this.children) {
			const cc = child.#copy(false);
			cc.parent = inst;
			inst.children.push(cc);
		}
		this.doc.currentPage.appendChild(inst);
		return inst;
	}

	async getMainComponentAsync(): Promise<FakeNode | null> {
		return this.main;
	}

	setProperties(props: Record<string, string | boolean>): void {
		for (const [key, value] of Object.entries(props)) {
			const prop = this.componentProperties[key];
			if (!prop) throw new Error(`No existe la propiedad ${key}`);
			// setProperties no toca slots
			if (prop.type === "SLOT") throw new Error("cannotSetSlotProperty");
			// El valor tiene que ser del tipo de la propiedad: Figma lanza si no
			if (prop.type === "BOOLEAN" && typeof value !== "boolean")
				throw new Error(`Invalid value for ${key}: expected a boolean`);
			if (prop.type === "TEXT" && typeof value !== "string")
				throw new Error(`Invalid value for ${key}: expected a string`);
			// Trampa 23 (medida en el archivo de pruebas, 2026-11-12): un INSTANCE_SWAP lleva el ID de un componente que existe; si no,
			// lanza «Property value is incompatible with component property type». Cambia el componente principal de la
			// instancia anidada que referencia la propiedad
			let swapTo: FakeNode | null = null;
			if (prop.type === "INSTANCE_SWAP") {
				swapTo =
					typeof value === "string" ? (this.doc.all.get(value) ?? null) : null;
				if (swapTo === null || swapTo.removed || swapTo.type !== "COMPONENT")
					throw new Error(
						"Property value is incompatible with component property type",
					);
			}
			prop.value = value;
			this.#explicit.set(key, value);
			if (this.#ownerInstance() !== null)
				this.#overridden.add("componentProperties");
			for (const d of this.descendants()) {
				const refs = d.componentPropertyReferences;
				if (!refs || d.#ownerInstance() !== this) continue;
				if (refs["characters"] === key) d.characters = String(value);
				if (refs["visible"] === key) d.visible = Boolean(value);
				if (swapTo !== null && refs["mainComponent"] === key) {
					d.main = swapTo;
					d.name = swapTo.name;
					d.#overridden.add("mainComponent");
				}
			}
		}
	}

	// La instancia más cercana por encima (las capas de una anidada responden a las props de la anidada)
	#ownerInstance(): FakeNode | null {
		let p = this.parent;
		while (p && p.type !== "INSTANCE") p = p.parent;
		return p;
	}

	// --- APIs obsoletas ---
	get instances(): never {
		throw new Error("`.instances` está obsoleto: usa getInstancesAsync()");
	}

	resetOverrides(): never {
		throw new Error("`resetOverrides` está obsoleto: usa removeOverrides()");
	}

	getStyledTextSegments(fields: string[] = []): Rec[] {
		if (this.segments.length > 0) return this.segments;
		return this.#ranges.map((r) => {
			const out: Rec = {
				start: r.start,
				end: r.end,
				characters: this.#characters.slice(r.start, r.end),
			};
			for (const f of fields) out[f] = (r as unknown as Rec)[f];
			return out;
		});
	}
}

export type FakeCollection = {
	id: string;
	name: string;
	modes: { modeId: string; name: string }[];
	defaultModeId: string;
	variableIds: string[];
};

export type FakeVariable = {
	id: string;
	name: string;
	variableCollectionId: string;
	resolvedType: string;
	valuesByMode: Record<string, unknown>;
};

export class FakeFigma {
	counter = 0;
	readonly all = new Map<string, FakeNode>();
	readonly loadedFonts = new Set<string>();
	readonly stats: Stats = { findAll: 0, reactionWrites: 0 };
	readonly mixed = Symbol("mixed");
	// Opt-in (los pasos de F2 y F3 se escribieron sin estas reglas): cargar la fuente antes de CUALQUIER cambio de fuente, y un
	// motor de auto-layout mínimo que da posición a los hijos del flujo
	strictText = false;
	// Opt-in: las trampas 13 y 15 (sin verificar) como error; los pasos de F3 ya pasaron en Figma real sin ellas
	strictLayout = false;
	autoLayout = false;
	// Opt-in (sin verificar): un nombre de propiedad repetido y un INSTANCE_SWAP con un id que no
	// es de un componente lanzan al crearlos; lo cierra `make kit-contract`
	strictProperties = false;
	// Opt-in: el ancho de un marco horizontal que se ajusta al contenido se recalcula al cambiar `visible` de una capa
	hugLayout = false;
	// El encuadre del lienzo: solo se apunta a qué nodos
	readonly viewport = {
		zoomed: [] as FakeNode[],
		scrollAndZoomIntoView(nodes: FakeNode[]): void {
			this.zoomed = nodes;
		},
	};
	readonly textStyles: {
		id: string;
		name: string;
		fontName: FontName;
		fontSize: number;
		lineHeight: Rec;
		letterSpacing: Rec;
		textCase: string;
		key: string;
		type: "TEXT";
	}[] = [];
	readonly effectStyles: {
		id: string;
		name: string;
		key: string;
		type: "EFFECT";
		effects: Rec[];
	}[] = [];
	readonly paintStyles: {
		id: string;
		name: string;
		key: string;
		type: "PAINT";
		paints: Rec[];
	}[] = [];
	readonly collections: FakeCollection[] = [];
	readonly variableList = new Map<string, FakeVariable>();
	readonly root: FakeNode;
	currentPage: FakeNode;
	readonly variables;

	constructor() {
		this.root = new FakeNode(this, "DOCUMENT", "Archivo");
		this.currentPage = this.createPage();
		this.currentPage.name = "Página 1";
		this.variables = {
			getLocalVariableCollectionsAsync: async () => this.collections,
			getVariableByIdAsync: async (id: string) =>
				this.variableList.get(id) ?? null,
			getVariableCollectionByIdAsync: async (id: string) =>
				this.collections.find((c) => c.id === id) ?? null,
			// el paint que devuelve ya no lleva la opacidad
			setBoundVariableForPaint: (
				paint: Rec,
				field: string,
				variable: FakeVariable,
			) => ({
				type: paint["type"],
				color: paint["color"],
				boundVariables: {
					[field]: { type: "VARIABLE_ALIAS", id: variable.id },
				},
			}),
		};
	}

	createPage(): FakeNode {
		const page = new FakeNode(this, "PAGE", "Página");
		page.parent = this.root;
		this.root.children.push(page);
		return page;
	}

	createText(): FakeNode {
		const text = new FakeNode(this, "TEXT", "Text");
		text.measured = true;
		this.currentPage.appendChild(text);
		return text;
	}

	createRectangle(): FakeNode {
		const rect = new FakeNode(this, "RECTANGLE", "Rectangle");
		this.currentPage.appendChild(rect);
		return rect;
	}

	async getLocalTextStylesAsync() {
		return this.textStyles;
	}

	async getLocalEffectStylesAsync() {
		return this.effectStyles;
	}

	// Un estilo (de texto o de efecto) por su id; null si no existe
	async getStyleByIdAsync(id: string) {
		return (
			this.textStyles.find((s) => s.id === id) ??
			this.effectStyles.find((s) => s.id === id) ??
			this.paintStyles.find((s) => s.id === id) ??
			null
		);
	}

	// Un estilo de texto local para el archivo de un test
	textStyle(
		family: string,
		style: string,
		fontSize: number,
		options: {
			lineHeight?: number;
			letterSpacing?: number;
			textCase?: string;
		} = {},
	) {
		const made = {
			id: `S:${++this.counter}`,
			name: `${family}/${fontSize}/${style}`,
			fontName: { family, style },
			fontSize,
			lineHeight:
				options.lineHeight === undefined
					? { unit: "AUTO" }
					: { unit: "PIXELS", value: options.lineHeight },
			letterSpacing: { unit: "PIXELS", value: options.letterSpacing ?? 0 },
			textCase: options.textCase ?? "ORIGINAL",
			key: `st${this.counter}`,
			type: "TEXT" as const,
		};
		this.textStyles.push(made);
		return made;
	}

	effectStyle(name: string, effects: Rec[] = [{ type: "DROP_SHADOW" }]) {
		const made = {
			id: `E:${++this.counter}`,
			name,
			key: `se${this.counter}`,
			type: "EFFECT" as const,
			effects,
		};
		this.effectStyles.push(made);
		return made;
	}

	// Un estilo de relleno local (para design-context@1)
	paintStyle(name: string, paints: Rec[]) {
		const made = {
			id: `P:${++this.counter}`,
			name,
			key: `sp${this.counter}`,
			type: "PAINT" as const,
			paints,
		};
		this.paintStyles.push(made);
		return made;
	}

	createVector(): FakeNode {
		const vector = new FakeNode(this, "VECTOR", "Vector");
		this.currentPage.appendChild(vector);
		return vector;
	}

	createFrame(): FakeNode {
		const frame = new FakeNode(this, "FRAME", "Frame");
		this.currentPage.appendChild(frame);
		return frame;
	}

	// vectorPaths no acepta lineto implícito tras `M`; createNodeFromSvg sí lee un SVG
	createNodeFromSvg(svg: string): FakeNode {
		if (!svg.includes("<svg")) throw new Error("Invalid SVG");
		const frame = new FakeNode(this, "FRAME", "svg");
		const vector = new FakeNode(this, "VECTOR", "Vector");
		// Trampa 21 (sin verificar): lo que el svg pinta con `stroke` o `fill` queda como pintura SOLID repintable
		const paints = (attr: string) =>
			[...svg.matchAll(new RegExp(`${attr}="#([0-9a-fA-F]{6})"`, "g"))].map(
				(m) => ({
					type: "SOLID",
					opacity: 1,
					color: {
						r: Number.parseInt((m[1] ?? "").slice(0, 2), 16) / 255,
						g: Number.parseInt((m[1] ?? "").slice(2, 4), 16) / 255,
						b: Number.parseInt((m[1] ?? "").slice(4, 6), 16) / 255,
					},
				}),
			);
		vector.strokes = paints("stroke");
		vector.fills = paints("fill");
		vector.parent = frame;
		frame.children.push(vector);
		this.currentPage.appendChild(frame);
		return frame;
	}

	// Un nodo suelto de cualquier tipo, para montar el árbol de un test
	node(parent: FakeNode, type: string, name: string): FakeNode {
		const n = new FakeNode(this, type, name);
		parent.appendChild(n);
		return n;
	}

	// El componente que sustituye a un nodo en su sitio, con lo que llevaba dentro
	createComponentFromNode(node: FakeNode): FakeNode {
		const parent = node.parent;
		if (parent === null) throw new Error("Cannot convert a detached node");
		const index = parent.children.indexOf(node);
		const comp = new FakeNode(this, "COMPONENT", node.name);
		comp.adoptStyleFrom(node);
		comp.width = node.width;
		comp.height = node.height;
		for (const k of node.children) k.parent = comp;
		comp.children = node.children;
		node.children = [];
		node.remove();
		parent.insertChild(index, comp);
		return comp;
	}

	// Un set con esas variantes. Medido (H7, archivo de pruebas 2026-11-12): las variantes conservan su id, quedan en x = 0 e y = 0 y el
	// set mide lo que la más grande (después no se reajusta solo, H13)
	combineAsVariants(components: FakeNode[], parent: FakeNode): FakeNode {
		const set = new FakeNode(this, "COMPONENT_SET", "Component set");
		parent.appendChild(set);
		let w = 0;
		let h = 0;
		for (const c of components) {
			set.appendChild(c);
			const props: Record<string, string> = {};
			for (const part of c.name.split(",")) {
				const [k, v] = part.split("=");
				if (k !== undefined && v !== undefined) props[k.trim()] = v.trim();
			}
			c.variantProperties = props;
			c.x = 0;
			c.y = 0;
			w = Math.max(w, c.width);
			h = Math.max(h, c.height);
		}
		set.resizeWithoutConstraints(Math.max(w, 0.01), Math.max(h, 0.01));
		return set;
	}

	// Figma real: PNG, JPEG o GIF de hasta 4096 px por lado (sin verificar, trampa 14: lo cierra `make kit-contract`)
	createImage(bytes: Uint8Array): { hash: string } {
		const info = readImageInfo(bytes);
		if (info === null) throw new Error("Image is of unsupported format");
		if (info.width > 4096 || info.height > 4096)
			throw new Error("Image is too large (max 4096px per side)");
		let h = 2166136261;
		for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
		return { hash: h.toString(16).padStart(8, "0") };
	}

	async setCurrentPageAsync(page: FakeNode): Promise<void> {
		this.currentPage = page;
	}

	async getNodeByIdAsync(id: string): Promise<FakeNode | null> {
		const node = this.all.get(id);
		return node && !node.removed ? node : null;
	}

	// obsoleto
	getNodeById(): never {
		throw new Error("getNodeById está obsoleto: usa getNodeByIdAsync");
	}

	// Si no está vacío, solo se pueden cargar las fuentes de esta lista («familia/estilo»); vacío: todas menos las «Ausente…»
	readonly loadedFontsToLoad = new Set<string>();

	variableByName(name: string): FakeVariable {
		const v = [...this.variableList.values()].find((x) => x.name === name);
		if (v === undefined) throw new Error(`No hay variable ${name}`);
		return v;
	}

	async loadFontAsync(font: FontName): Promise<void> {
		strictFontName(font, "loadFontAsync");
		if (
			font.family.startsWith("Ausente") ||
			(this.loadedFontsToLoad.size > 0 &&
				!this.loadedFontsToLoad.has(`${font.family}/${font.style}`))
		)
			throw new Error(`Font ${font.family} ${font.style} not found`);
		this.loadedFonts.add(`${font.family}/${font.style}`);
	}

	// --- ayudas para montar el archivo de un test ---
	page(name: string): FakeNode {
		const p = this.createPage();
		p.name = name;
		return p;
	}

	text(parent: FakeNode, name: string, chars: string, refs?: Rec): FakeNode {
		const t = new FakeNode(this, "TEXT", name);
		t.seedCharacters(chars);
		if (refs) t.componentPropertyReferences = refs;
		parent.appendChild(t);
		return t;
	}

	// Un set con una variante por cada combinación de `variants`; cada una con un texto ligado a `Label`
	componentSet(
		page: FakeNode,
		name: string,
		variants: Record<string, string>[],
	): FakeNode {
		const set = new FakeNode(this, "COMPONENT_SET", name);
		page.appendChild(set);
		const labelKey = set.addComponentProperty("Label", "TEXT", "Etiqueta");
		const showKey = set.addComponentProperty(
			"Mostrar descripción",
			"BOOLEAN",
			true,
		);
		const descKey = set.addComponentProperty("Descripción", "TEXT", "");
		for (const props of variants) {
			const v = new FakeNode(
				this,
				"COMPONENT",
				Object.entries(props)
					.map(([k, x]) => `${k}=${x}`)
					.join(", "),
			);
			v.variantProperties = props;
			set.appendChild(v);
			// Figma real: el set declara cada propiedad de variante con sus valores
			for (const [name, value] of Object.entries(props)) {
				const def = set.componentPropertyDefinitions[name] ?? {
					type: "VARIANT",
					defaultValue: value,
					variantOptions: [],
				};
				if (!def.variantOptions?.includes(value))
					def.variantOptions?.push(value);
				set.componentPropertyDefinitions[name] = def;
			}
			this.text(v, "label", "Etiqueta", { characters: labelKey });
			this.text(v, "desc", "Descripción", {
				visible: showKey,
				characters: descKey,
			});
		}
		return set;
	}

	collection(
		name: string,
		modeCount: number,
		vars: Record<string, unknown>,
	): FakeCollection {
		const modes = Array.from({ length: modeCount }, (_, i) => ({
			modeId: `m${this.counter}:${i}`,
			name: `Modo ${i + 1}`,
		}));
		const c: FakeCollection = {
			id: `c${++this.counter}`,
			name,
			modes,
			defaultModeId: modes[0]?.modeId ?? "",
			variableIds: [],
		};
		for (const [vname, value] of Object.entries(vars)) {
			const v: FakeVariable = {
				id: `v${++this.counter}`,
				name: vname,
				variableCollectionId: c.id,
				resolvedType:
					typeof value === "number"
						? "FLOAT"
						: typeof value === "object" && value !== null && "r" in value
							? "COLOR"
							: "STRING",
				valuesByMode: {},
			};
			// Figma devuelve los colores con alfa (RGBA), aunque se guarden como RGB
			const stored =
				typeof value === "object" &&
				value !== null &&
				"r" in value &&
				!("a" in value)
					? { ...value, a: 1 }
					: value;
			for (const m of modes) v.valuesByMode[m.modeId] = stored;
			this.variableList.set(v.id, v);
			c.variableIds.push(v.id);
		}
		this.collections.push(c);
		return c;
	}
}

// Instala un `figma` nuevo en globalThis y lo devuelve
export function installFakeFigma(): FakeFigma {
	const fake = new FakeFigma();
	(globalThis as unknown as { figma: unknown }).figma = fake;
	return fake;
}
