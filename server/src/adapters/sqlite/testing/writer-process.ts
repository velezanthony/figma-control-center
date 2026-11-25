// Proceso hijo de los tests de concurrencia: abre la base única, da de alta su proyecto si falta, registra N llamadas
// completas en él y sale con código distinto de 0 si algún registro falló.
// Uso: node writer-process.ts <base> <proyecto> <sesión> <n>
import { openFigmaDatabase } from "../database.ts";
import { SqliteActivityLog } from "../sqlite-activity-log.ts";
import { toolCalled, toolFinished } from "./events.ts";
import { ensureProject } from "./projects.ts";

const [file, project, sessionId, count] = process.argv.slice(2);
if (
	file === undefined ||
	project === undefined ||
	sessionId === undefined ||
	count === undefined
) {
	console.error("uso: writer-process.ts <base> <proyecto> <sesión> <n>");
	process.exit(2);
}

const failures: string[] = [];
const db = openFigmaDatabase(file);
ensureProject(db, Number(project));
const log = new SqliteActivityLog({
	projectId: Number(project),
	db,
	warn: (message) => failures.push(message),
});
for (let i = 0; i < Number(count); i++) {
	const callId = `${sessionId}-${i}`;
	log.record(toolCalled(sessionId, callId, "figma_status", {}, i * 10));
	log.record(
		toolFinished(sessionId, callId, i * 10 + 5, { touchedNodeIds: [`${i}:1`] }),
	);
}
if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
