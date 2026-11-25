export type Orientation = "vertical" | "horizontal";

const KEYS = {
	vertical: { next: "ArrowDown", prev: "ArrowUp" },
	horizontal: { next: "ArrowRight", prev: "ArrowLeft" },
} as const;
const HOME = "Home";
const END = "End";

// Índice al que debe pasar el foco tras una tecla, o null si la tecla no navega
export function nextIndex(
	key: string,
	current: number,
	length: number,
	orientation: Orientation,
): number | null {
	if (length === 0) return null;
	if (key === HOME) return 0;
	if (key === END) return length - 1;
	if (key === KEYS[orientation].next) return (current + 1) % length;
	if (key === KEYS[orientation].prev) return (current - 1 + length) % length;
	return null;
}
