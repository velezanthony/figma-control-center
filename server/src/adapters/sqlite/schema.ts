// Esquema de la base única de la máquina (output/figma.db): los proyectos y el histórico de TODOS ellos. Cada tabla de
// datos de proyecto lleva `project_id` (FK a `projects`, ON DELETE CASCADE): borrar un proyecto borra su histórico y
// ningún repositorio lee ni escribe sin él (ver los adaptadores sqlite-*.ts). Los índices empiezan por `project_id`
// donde se filtra. Lo que Drizzle no sabe expresar (las tablas FTS5 y sus triggers) vive en migraciones SQL propias.
import {
	blob,
	foreignKey,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Una fila por proyecto. AUTOINCREMENT: SQLite no reutiliza un id aunque se borre la fila (lo recuerda en
// sqlite_sequence), así que borrar el 3 nunca devuelve el 3. El tope (1..32767) lo pone la validación del id.
// Los índices únicos sustituyen a las comprobaciones a mano: dos proyectos no comparten archivo de Figma ni carpeta.
// `file_key` es la clave del archivo (la misma sea cual sea la URL). `output_dir` se guarda ya resuelta
// (por defecto, <salida>/<id>): un choque con la carpeta de otro proyecto, también la de por defecto, salta en el índice.
export const projects = sqliteTable(
	"projects",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		name: text("name").notNull(),
		projectDir: text("project_dir").notNull(),
		fileUrl: text("file_url").notNull(),
		fileKey: text("file_key").notNull(),
		scriptsRoots: text("scripts_roots"),
		outputDir: text("output_dir").notNull(),
	},
	(t) => [
		uniqueIndex("projects_file_key").on(t.fileKey),
		uniqueIndex("projects_output_dir").on(t.outputDir),
	],
);

// Ajustes del panel (clave → valor como texto): la parte editable de la configuración, validada con el esquema de la
// configuración antes de guardarse. Son de la máquina, no de un proyecto: sin project_id
export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

const projectRef = () =>
	integer("project_id")
		.notNull()
		.references(() => projects.id, { onDelete: "cascade" });

// Telemetría de una sesión del servidor MCP (un proceso) y sus contadores, que se actualizan al registrar.
// Un mismo proceso puede servir a dos proyectos a lo largo de su vida: la sesión es única POR PROYECTO
export const sessions = sqliteTable(
	"sessions",
	{
		projectId: projectRef(),
		id: text("id").notNull(),
		startedAt: integer("started_at").notNull(),
		lastSeenAt: integer("last_seen_at").notNull(),
		pid: integer("pid"),
		fileUrl: text("file_url"),
		calls: integer("calls").notNull().default(0),
		writes: integer("writes").notNull().default(0),
		errors: integer("errors").notNull().default(0),
		totalMs: integer("total_ms").notNull().default(0),
		chatTokenHash: text("chat_token_hash"),
	},
	(t) => [primaryKey({ columns: [t.projectId, t.id] })],
);

// Registro inmutable de lo que ocurrió: el payload es el evento tal cual. Su id autoincremental
// es el cursor del tiempo real (SSE) y de la importación; cada proyecto lee solo los suyos
export const events = sqliteTable(
	"events",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		projectId: projectRef(),
		sessionId: text("session_id").notNull(),
		callId: text("call_id"),
		at: integer("at").notNull(),
		type: text("type").notNull(),
		payload: text("payload").notNull(),
	},
	(t) => [
		foreignKey({
			columns: [t.projectId, t.sessionId],
			foreignColumns: [sessions.projectId, sessions.id],
		}).onDelete("cascade"),
		index("events_project_id").on(t.projectId, t.id),
		index("events_project_at").on(t.projectId, t.at),
		index("events_project_session_at").on(t.projectId, t.sessionId, t.at),
		index("events_project_call").on(t.projectId, t.callId),
		index("events_project_type_id").on(t.projectId, t.type, t.id),
	],
);

// Una fila por llamada a una herramienta (empieza en tool_called, se completa en tool_finished): es lo
// que se lista, filtra y busca. `summary` es la frase corta que indexa FTS5
export const calls = sqliteTable(
	"calls",
	{
		projectId: projectRef(),
		callId: text("call_id").notNull(),
		sessionId: text("session_id").notNull(),
		startedAt: integer("started_at").notNull(),
		finishedAt: integer("finished_at"),
		tool: text("tool").notNull(),
		status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
		ms: integer("ms"),
		isWrite: integer("is_write", { mode: "boolean" }).notNull(),
		errorType: text("error_type"),
		errorMessage: text("error_message"),
		nextStep: text("next_step"),
		errorLine: integer("error_line"),
		retryable: integer("retryable", { mode: "boolean" }),
		jobId: text("job_id"),
		startsJob: integer("starts_job", { mode: "boolean" })
			.notNull()
			.default(false),
		argsSummary: text("args_summary").notNull(),
		resultPath: text("result_path"),
		summary: text("summary").notNull(),
		touchedCount: integer("touched_count").notNull().default(0),
		// Ids de los nodos tocados (de la llamada y de su job) y el texto del error del job, separados por espacios:
		// lo que FTS5 busca además del resumen y del error de la llamada
		extraText: text("extra_text").notNull().default(""),
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.callId] }),
		foreignKey({
			columns: [t.projectId, t.sessionId],
			foreignColumns: [sessions.projectId, sessions.id],
		}).onDelete("cascade"),
		index("calls_project_started").on(t.projectId, t.startedAt),
		index("calls_project_session_started").on(
			t.projectId,
			t.sessionId,
			t.startedAt,
		),
		index("calls_project_tool_started").on(t.projectId, t.tool, t.startedAt),
		index("calls_project_status_started").on(
			t.projectId,
			t.status,
			t.startedAt,
		),
		index("calls_project_job").on(t.projectId, t.jobId),
	],
);

export const jobs = sqliteTable(
	"jobs",
	{
		projectId: projectRef(),
		id: text("id").notNull(),
		sessionId: text("session_id").notNull(),
		callId: text("call_id"),
		startedAt: integer("started_at").notNull(),
		finishedAt: integer("finished_at"),
		// `cancelled` solo le pasa a un lote (figma_build); un job de script nunca se cancela
		status: text("status", {
			enum: ["running", "done", "failed", "cancelled"],
		}).notNull(),
		ms: integer("ms"),
		errorType: text("error_type"),
		errorMessage: text("error_message"),
		nextStep: text("next_step"),
		errorLine: integer("error_line"),
		touchedJson: text("touched_json").notNull().default("[]"),
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.id] }),
		index("jobs_project_call").on(t.projectId, t.callId),
		index("jobs_project_status").on(t.projectId, t.status),
	],
);

// Un paso de un lote (figma_build), tal como quedó al terminar: alimenta figma_history_call y la página Jobs.
// `job_id` apunta al job del lote, pero sin FK dura: los pasos se registran según terminan, antes de que
// tool_finished cree la fila de `jobs`, así que una FK con foreign_keys=ON rechazaría esos primeros pasos.
// (project_id, job_id, step_index) es único: el último build_step_finished de cada paso manda (upsert in situ)
export const buildSteps = sqliteTable(
	"build_steps",
	{
		projectId: projectRef(),
		jobId: text("job_id").notNull(),
		stepIndex: integer("step_index").notNull(),
		file: text("file").notNull(),
		status: text("status", {
			enum: ["pending", "running", "done", "failed", "skipped", "cancelled"],
		}).notNull(),
		ms: integer("ms"),
		touchedCount: integer("touched_count").notNull().default(0),
		errorType: text("error_type"),
		errorMessage: text("error_message"),
		nextStep: text("next_step"),
		errorLine: integer("error_line"),
		warning: text("warning"),
		// Lo que devolvió el paso: el JSON si cabía en el tope, o ruta y bytes del fichero si no. NULL en los lotes antiguos.
		resultJson: text("result_json"),
		resultPath: text("result_path"),
		resultBytes: integer("result_bytes"),
	},
	(t) => [primaryKey({ columns: [t.projectId, t.jobId, t.stepIndex] })],
);

// Qué nodos tocó cada llamada (de la llamada o de su job): «qué llamadas tocaron el nodo X»
export const callNodes = sqliteTable(
	"call_nodes",
	{
		projectId: projectRef(),
		callId: text("call_id").notNull(),
		nodeId: text("node_id").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.callId, t.nodeId] }),
		foreignKey({
			columns: [t.projectId, t.callId],
			foreignColumns: [calls.projectId, calls.callId],
		}).onDelete("cascade"),
		index("call_nodes_project_node").on(t.projectId, t.nodeId),
	],
);

// Resumen por nodo, actualizado al registrar (upsert): veces tocado y última llamada
export const nodesTouched = sqliteTable(
	"nodes_touched",
	{
		projectId: projectRef(),
		nodeId: text("node_id").notNull(),
		fileUrl: text("file_url"),
		firstAt: integer("first_at").notNull(),
		lastAt: integer("last_at").notNull(),
		touchCount: integer("touch_count").notNull(),
		lastSessionId: text("last_session_id").notNull(),
		lastCallId: text("last_call_id").notNull(),
	},
	(t) => [primaryKey({ columns: [t.projectId, t.nodeId] })],
);

export const captures = sqliteTable(
	"captures",
	{
		projectId: projectRef(),
		callId: text("call_id").notNull(),
		nodeId: text("node_id").notNull(),
		path: text("path").notNull(),
		width: integer("width").notNull(),
		height: integer("height").notNull(),
		at: integer("at").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.callId, t.path] }),
		foreignKey({
			columns: [t.projectId, t.callId],
			foreignColumns: [calls.projectId, calls.callId],
		}).onDelete("cascade"),
		index("captures_project_at").on(t.projectId, t.at),
	],
);

// Marcas de «esto ya se hizo» por proyecto (p. ej. la importación del activity.jsonl)
export const meta = sqliteTable(
	"meta",
	{
		projectId: projectRef(),
		key: text("key").notNull(),
		value: text("value").notNull(),
	},
	(t) => [primaryKey({ columns: [t.projectId, t.key] })],
);

// Chat del panel con una sesión (channel). El panel escribe `in`; la sesión los recoge, los empuja a Claude y
// guarda su respuesta como `out`. `sender_hash` es la prueba de que el mensaje lo escribió el panel con el
// token de esa sesión: sin ella, el mensaje no se entrega
export const chatMessages = sqliteTable(
	"chat_messages",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		projectId: projectRef(),
		sessionId: text("session_id").notNull(),
		direction: text("direction", { enum: ["in", "out"] }).notNull(),
		chatId: text("chat_id").notNull(),
		body: text("body").notNull(),
		at: integer("at").notNull(),
		deliveredAt: integer("delivered_at"),
		status: text("status", {
			enum: ["pending", "delivered", "rejected"],
		}).notNull(),
		senderHash: text("sender_hash"),
	},
	(t) => [
		foreignKey({
			columns: [t.projectId, t.sessionId],
			foreignColumns: [sessions.projectId, sessions.id],
		}).onDelete("cascade"),
		index("chat_project_session_id").on(t.projectId, t.sessionId, t.id),
		index("chat_project_pending").on(
			t.projectId,
			t.sessionId,
			t.direction,
			t.status,
		),
		index("chat_project_chat").on(t.projectId, t.sessionId, t.chatId),
	],
);

// Peticiones de permiso que Claude Code relaya al canal. El panel decide (`allowed`/`denied`) firmando con el token
// de la sesión (`decider_hash`); la sesión devuelve el veredicto a Claude Code y marca `sent_at`. `rejected`: una
// decisión sin firma válida, que nunca se devuelve. (project_id, session_id, request_id) es único: un id repetido se ignora
export const permissionRequests = sqliteTable(
	"permission_requests",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		projectId: projectRef(),
		sessionId: text("session_id").notNull(),
		requestId: text("request_id").notNull(),
		toolName: text("tool_name").notNull(),
		description: text("description").notNull(),
		inputPreview: text("input_preview").notNull(),
		at: integer("at").notNull(),
		status: text("status", {
			enum: ["pending", "allowed", "denied", "rejected"],
		}).notNull(),
		decidedAt: integer("decided_at"),
		deciderHash: text("decider_hash"),
		sentAt: integer("sent_at"),
	},
	(t) => [
		foreignKey({
			columns: [t.projectId, t.sessionId],
			foreignColumns: [sessions.projectId, sessions.id],
		}).onDelete("cascade"),
		uniqueIndex("permission_project_session_request").on(
			t.projectId,
			t.sessionId,
			t.requestId,
		),
		index("permission_project_session_id").on(t.projectId, t.sessionId, t.id),
	],
);

// Peticiones de cancelar un lote que el panel deja y la sesión dueña del job ejecuta (`done` + `handled_at`).
// Una fila por job basta: pedir dos veces la misma cancelación no hace nada más
export const cancelRequests = sqliteTable(
	"cancel_requests",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		projectId: projectRef(),
		sessionId: text("session_id").notNull(),
		jobId: text("job_id").notNull(),
		at: integer("at").notNull(),
		status: text("status", { enum: ["pending", "done"] }).notNull(),
		handledAt: integer("handled_at"),
	},
	(t) => [
		foreignKey({
			columns: [t.projectId, t.sessionId],
			foreignColumns: [sessions.projectId, sessions.id],
		}).onDelete("cascade"),
		uniqueIndex("cancel_project_job").on(t.projectId, t.jobId),
		index("cancel_project_session_status").on(
			t.projectId,
			t.sessionId,
			t.status,
		),
	],
);

// --- Historial de intentos ---
// Un contenido (un script, unos params, el kit…) es UNA fila por (proyecto, sha256): lanzar diez veces el mismo script no
// repite nada. `content` va comprimido con gzip; con `stored = 'too_big'` (pasó de FCC_SCRIPT_MAX_BYTES) solo quedan
// el hash y el tamaño. Sin FK a los intentos que lo usan: la retención borra primero los intentos y después los
// contenidos que ya no usa ninguno
export const scriptBlobs = sqliteTable(
	"script_blobs",
	{
		projectId: projectRef(),
		sha256: text("sha256").notNull(),
		// js: un script o un módulo; json: unos params o una entrada de screens@1
		kind: text("kind", { enum: ["js", "json"] }).notNull(),
		bytes: integer("bytes").notNull(),
		stored: text("stored", { enum: ["full", "too_big"] }).notNull(),
		content: blob("content", { mode: "buffer" }),
		firstAt: integer("first_at").notNull(),
		lastUsedAt: integer("last_used_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.projectId, t.sha256] })],
);

// Una ejecución de un script. `target` es lo que se intenta (la ruta del fichero relativa a su raíz de scripts, o la clave de
// una pantalla) y `n` el número de intento por proyecto, tipo y objetivo. Sin FK dura a `calls` (como build_steps): un
// intento protegido por la retención sobrevive a su llamada
export const attempts = sqliteTable(
	"attempts",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		projectId: projectRef(),
		kind: text("kind", {
			enum: ["run_script", "build_step", "capture"],
		}).notNull(),
		target: text("target").notNull(),
		n: integer("n").notNull(),
		callId: text("call_id"),
		jobId: text("job_id"),
		stepIndex: integer("step_index"),
		startedAt: integer("started_at").notNull(),
		finishedAt: integer("finished_at").notNull(),
		status: text("status", {
			enum: ["ok", "contract_error", "error"],
		}).notNull(),
		firstError: text("first_error"),
		kit: text("kit").notNull(),
		kitSha256: text("kit_sha256").notNull(),
		// nombre, ruta, tamaño y sha256 de cada asset (los bytes no se copian)
		assetsJson: text("assets_json"),
	},
	(t) => [
		uniqueIndex("attempts_project_target_n").on(
			t.projectId,
			t.kind,
			t.target,
			t.n,
		),
		index("attempts_project_call").on(t.projectId, t.callId),
		index("attempts_project_started").on(t.projectId, t.startedAt),
	],
);

// Qué contenidos usó un intento, por papel (step, params, kit, hooks, screens, sheets, map, plan, recognize). `path` es '' si el papel no tiene ruta
export const attemptScripts = sqliteTable(
	"attempt_scripts",
	{
		projectId: projectRef(),
		attemptId: integer("attempt_id")
			.notNull()
			.references(() => attempts.id, { onDelete: "cascade" }),
		role: text("role", {
			enum: [
				"step",
				"params",
				"kit",
				"hooks",
				"screens",
				"sheets",
				"plan",
				"map",
				"recognize",
			],
		}).notNull(),
		path: text("path").notNull().default(""),
		sha256: text("sha256").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.attemptId, t.role, t.path] }),
		index("attempt_scripts_project_sha").on(t.projectId, t.sha256),
	],
);
