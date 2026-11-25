// Carrera común entre un trabajo y el plazo blando de M1: si el trabajo acaba antes, se devuelve su valor; si no,
// se devuelve `running` y el que llama se queda con el trabajo en marcha (lo registra como job y lo sigue). Lo usan
// `run-script` (un script largo) y `run-build` (un lote largo) para no duplicar la carrera.
const DEADLINE = Symbol("deadline");

export type SoftDeadlineResult<T> =
	| { readonly kind: "finished"; readonly value: T }
	| { readonly kind: "running" };

export async function withSoftDeadline<T>(
	work: Promise<T>,
	softDeadlineMs: number,
): Promise<SoftDeadlineResult<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<typeof DEADLINE>((resolve) => {
		timer = setTimeout(() => resolve(DEADLINE), softDeadlineMs);
	});
	try {
		const first = await Promise.race([work, deadline]);
		return first === DEADLINE
			? { kind: "running" }
			: { kind: "finished", value: first };
	} finally {
		clearTimeout(timer);
	}
}
