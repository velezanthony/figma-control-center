// Alto del campo: lo que mide su contenido (scrollHeight, ya con el relleno), entre un mínimo y un máximo de líneas
export function composerHeight(a: {
	readonly scrollHeight: number;
	readonly lineHeight: number;
	readonly minLines: number;
	readonly maxLines: number;
	readonly padding: number;
}): number {
	const min = a.minLines * a.lineHeight + a.padding;
	const max = a.maxLines * a.lineHeight + a.padding;
	return Math.min(max, Math.max(min, a.scrollHeight));
}

// Intro envía; Mayús+Intro es salto de línea; el Intro que cierra una composición (IME, acentos) no es un envío
export const shouldSubmit = (e: {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly isComposing: boolean;
}): boolean => e.key === "Enter" && !e.shiftKey && !e.isComposing;
