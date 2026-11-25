import { layoutSize, type Placement, placeFloating } from "./floating.ts";

export type FloatParams = {
	readonly anchor: HTMLElement | undefined;
	readonly placement: Placement;
	readonly gap: number;
	// Falso: el elemento queda oculto (tooltip siempre montado). Por defecto, visible mientras exista
	readonly open?: boolean;
};

// Acción de Svelte: saca el elemento a la capa superior (popover) y lo coloca con `fixed` junto a su
// disparador, así ningún contenedor con overflow lo recorta. Se recoloca al hacer scroll o redimensionar
export function float(node: HTMLElement, initial: FloatParams) {
	let params = initial;
	let listening = false;

	const place = () => {
		if (!params.anchor) return;
		const { left, top, right, bottom } = params.anchor.getBoundingClientRect();
		// El tamaño de maqueta, no el de pantalla: al abrirse entra escalado (`starting:scale-95`) y con ese tamaño, más
		// pequeño, el borde de la ventana se calcularía mal y al crecer se le comería el margen
		const placed = placeFloating(
			{ left, top, right, bottom },
			layoutSize(getComputedStyle(node)),
			{ width: innerWidth, height: innerHeight },
			params.placement,
			params.gap,
		);
		node.style.top = `${placed.top}px`;
		node.style.left = `${placed.left}px`;
	};

	const listen = (on: boolean) => {
		if (on === listening) return;
		listening = on;
		const toggle = on ? addEventListener : removeEventListener;
		toggle("scroll", place, true);
		toggle("resize", place);
	};

	const sync = () => {
		if (params.open === false) {
			listen(false);
			if (node.matches(":popover-open")) node.hidePopover();
			return;
		}
		if (!node.matches(":popover-open")) node.showPopover();
		place();
		listen(true);
	};

	sync();
	return {
		update(next: FloatParams) {
			params = next;
			sync();
		},
		destroy() {
			listen(false);
		},
	};
}
