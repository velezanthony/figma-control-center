// Puntos de inicio del prototipo: `flowStartingPoints` se asigna entero, así que se lee, se
// cambia o se añade el propio por nombre y se vuelve a asignar, sin borrar los de otros
import { note } from "./core.ts";
import type { FrameNode, PageNode } from "./types.ts";

export function startFlow(
	page: PageNode,
	frame: FrameNode,
	name: string,
): { changed: boolean } {
	const points = page.flowStartingPoints;
	const mine = points.find((p) => p.name === name);
	if (mine?.nodeId === frame.id) return { changed: false };
	const point = { nodeId: frame.id, name };
	// Figma lanza con dos puntos del mismo frame (medido): el propio sustituye al de su nombre y a cualquier otro que apunte
	// al mismo frame
	const next = points
		.filter((p) => p.name !== name && p.nodeId !== frame.id)
		.map((p) => ({ nodeId: p.nodeId, name: p.name }));
	const at = points.findIndex((p) => p.name === name);
	next.splice(at === -1 ? next.length : Math.min(at, next.length), 0, point);
	page.flowStartingPoints = next;
	note.mutated(page);
	return { changed: true };
}
