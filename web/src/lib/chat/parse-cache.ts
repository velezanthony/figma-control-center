// Caché del resultado de interpretar el Markdown de cada mensaje, por id: al volver a pasar por un mensaje que
// ya se había desmontado (la lista está virtualizada) no se interpreta otra vez. Acotada: se expulsa el menos reciente
export function createParseCache<T>(parse: (body: string) => T, max: number) {
	const entries = new Map<number, { body: string; value: T }>();
	return {
		get size() {
			return entries.size;
		},
		get(id: number, body: string): T {
			const hit = entries.get(id);
			if (hit !== undefined && hit.body === body) {
				entries.delete(id);
				entries.set(id, hit);
				return hit.value;
			}
			const value = parse(body);
			entries.delete(id);
			entries.set(id, { body, value });
			const oldest = entries.keys().next();
			if (entries.size > max && !oldest.done) entries.delete(oldest.value);
			return value;
		},
	};
}
