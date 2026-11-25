export type ScrollMetrics = {
	readonly scrollTop: number;
	readonly clientHeight: number;
	readonly scrollHeight: number;
};

// Margen para contar como «abajo»: el scroll con rueda y los redondeos de pantallas HiDPI no caen exactos
const BOTTOM_TOLERANCE_PX = 40;

export const isAtBottom = (
	m: ScrollMetrics,
	tolerance: number = BOTTOM_TOLERANCE_PX,
): boolean => m.scrollHeight - m.scrollTop - m.clientHeight <= tolerance;

// Un píxel: el scroll de una lista pegada al final cae en fracciones de píxel
const SETTLED_EPSILON_PX = 1;

const distanceFromBottom = (m: ScrollMetrics): number =>
	m.scrollHeight - m.scrollTop - m.clientHeight;

// El navegador acota el scroll si la caja crece un instante y al volver no lo repone: una lista pegada al final y
// sin gesto del usuario que se queda corta (dentro de la tolerancia de «abajo») se vuelve a pegar. Un salto lejos
// del final no es ese acotado y se respeta
export const shouldRepin = (input: {
	pinned: boolean;
	userScrolling: boolean;
	metrics: ScrollMetrics;
}): boolean =>
	input.pinned &&
	!input.userScrolling &&
	distanceFromBottom(input.metrics) > SETTLED_EPSILON_PX &&
	isAtBottom(input.metrics);

// «Quieta»: el anclaje al final ya no tiene nada que mover. Si el usuario leía más arriba no ancla nada
export const isScrollSettled = (input: {
	pinned: boolean;
	metrics: ScrollMetrics;
}): boolean =>
	!input.pinned || distanceFromBottom(input.metrics) <= SETTLED_EPSILON_PX;

export const isExactlyAtBottom = (m: ScrollMetrics): boolean =>
	distanceFromBottom(m) <= SETTLED_EPSILON_PX;
