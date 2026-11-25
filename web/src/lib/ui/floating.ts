export type Rect = {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
};
export type Size = { readonly width: number; readonly height: number };
export type Placement =
	| "top"
	| "bottom"
	| "bottom-start"
	| "top-end"
	| "bottom-end";
export type Placed = {
	readonly top: number;
	readonly left: number;
	readonly placement: Placement;
};

// Separación mínima con el borde de la ventana
const EDGE = 8;

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(value, Math.max(min, max)));

// Tamaño de maqueta desde el estilo calculado, que no encoge la transformación de entrada (`starting:scale-95`);
// redondeado hacia arriba para que el flotante nunca invada el margen con el borde
export function layoutSize(style: {
	readonly width: string;
	readonly height: string;
}): Size {
	return {
		width: Math.ceil(Number.parseFloat(style.width)),
		height: Math.ceil(Number.parseFloat(style.height)),
	};
}

// Posición `fixed` de un flotante junto a su disparador: se voltea si no cabe y no se sale de la ventana
export function placeFloating(
	trigger: Rect,
	size: Size,
	viewport: Size,
	placement: Placement,
	gap: number,
): Placed {
	const below = trigger.bottom + gap;
	const above = trigger.top - gap - size.height;
	const fitsBelow = below + size.height <= viewport.height - EDGE;
	const fitsAbove = above >= EDGE;
	const wantsTop = placement === "top" || placement === "top-end";
	const useTop = wantsTop ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
	const end = placement === "top-end" || placement === "bottom-end";
	const left =
		placement === "bottom-start"
			? trigger.left
			: end
				? trigger.right - size.width
				: (trigger.left + trigger.right) / 2 - size.width / 2;
	return {
		top: useTop ? above : below,
		left: clamp(left, EDGE, viewport.width - size.width - EDGE),
		placement: useTop
			? end
				? "top-end"
				: "top"
			: placement === "top"
				? "bottom"
				: placement === "top-end"
					? "bottom-end"
					: placement,
	};
}
