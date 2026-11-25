// El elemento tiene que existir: si no, el test falla aquí con un mensaje claro (y TypeScript lo da por presente)
export function must<T>(value: T | null | undefined, what: string): T {
	if (value === null || value === undefined) throw new Error(`Falta ${what}`);
	return value;
}

// happy-dom no implementa la API popover: se simula lo mínimo que usa `float`
export function stubPopover(): void {
	const open = new WeakSet<Element>();
	const matches = Element.prototype.matches;
	Object.defineProperties(HTMLElement.prototype, {
		showPopover: {
			value(this: Element) {
				open.add(this);
			},
			configurable: true,
		},
		hidePopover: {
			value(this: Element) {
				open.delete(this);
			},
			configurable: true,
		},
	});
	Object.defineProperty(Element.prototype, "matches", {
		value(this: Element, selector: string) {
			return selector === ":popover-open"
				? open.has(this)
				: matches.call(this, selector);
		},
		configurable: true,
	});
}
