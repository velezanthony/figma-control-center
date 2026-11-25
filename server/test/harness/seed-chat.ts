// Siembra una conversación larga directamente en la base (para las pruebas de lista virtualizada y de búsqueda).
// Mensajes ya entregados, alternando pregunta y respuesta con Markdown; ids y horas deterministas.
import type { Environment } from "./environment.ts";

export const SEED_START_MS = Date.UTC(2026, 10, 2, 9, 0, 0);
const STEP_MS = 60_000;

export type SeedOptions = {
	readonly count: number;
	// Texto único que solo lleva el mensaje de esa posición (0 = el más antiguo)
	readonly needle?: { readonly at: number; readonly text: string };
};

const sql = (text: string): string => `'${text.replaceAll("'", "''")}'`;

export function seedChat(
	env: Environment,
	sessionId: string,
	options: SeedOptions,
): void {
	const rows: string[] = [];
	for (let i = 0; i < options.count; i++) {
		const incoming = i % 2 === 0;
		const needle = options.needle?.at === i ? ` ${options.needle.text}` : "";
		const body = incoming
			? `Pregunta número ${i}${needle}`
			: `Respuesta número ${i}${needle}\n\n- primer punto de ${i}\n- segundo punto de ${i}\n\nFin de la respuesta ${i}.`;
		rows.push(
			`(1, ${sql(sessionId)}, ${sql(incoming ? "in" : "out")}, ${sql(`seed-${Math.floor(i / 2)}`)}, ${sql(body)}, ${SEED_START_MS + i * STEP_MS}, 'delivered', NULL)`,
		);
	}
	env.exec(
		`INSERT INTO chat_messages(project_id, session_id, direction, chat_id, body, at, status, sender_hash) VALUES ${rows.join(",")}`,
	);
}

export function liveSessionId(env: Environment): string {
	const [row] = env.rows<{ id: string }>(
		"SELECT id FROM sessions WHERE chat_token_hash IS NOT NULL",
	);
	if (row === undefined) throw new Error("no hay ninguna sesión con chat");
	return row.id;
}
