// Única fuente de explicaciones del panel: los tooltips usan `short`; el glosario de la página de inicio, `short` y
// `long`. Un test (web/test/glossary.test.ts) falla si un código que la interfaz puede mostrar no tiene entrada.

export type GroupId =
	| "status"
	| "errors"
	| "ids"
	| "metrics"
	| "tools"
	| "columns"
	| "attempts"
	| "connection";

export type Term = {
	// El código tal como lo muestra la interfaz (un tipo de error, el nombre de una herramienta) o una clave propia
	readonly key: string;
	readonly label: string;
	readonly short: string;
	readonly long?: string;
	readonly group: GroupId;
};

export const GROUPS: readonly { id: GroupId; title: string }[] = [
	{ id: "status", title: "Estados" },
	{ id: "errors", title: "Errores" },
	{ id: "ids", title: "Identificadores" },
	{ id: "metrics", title: "Métricas" },
	{ id: "tools", title: "Herramientas" },
	{ id: "columns", title: "Columnas y filtros" },
	{ id: "attempts", title: "Intentos" },
	{ id: "connection", title: "Conexión" },
];

// Claves de los términos que no son un código del servidor: la interfaz las usa por estas constantes
export const STATUS_TERM = Object.freeze({
	ok: "status.ok",
	running: "status.running",
	error: "status.error",
	jobRunning: "status.jobRunning",
	jobDone: "status.jobDone",
	jobFailed: "status.jobFailed",
	jobCancelled: "status.jobCancelled",
} as const);

// Estado de cada paso de un lote (figma_build), tal como se ve en la página Jobs
export const STEP_STATUS_TERM = Object.freeze({
	pending: "step.pending",
	running: "step.running",
	done: "step.done",
	failed: "step.failed",
	skipped: "step.skipped",
	cancelled: "step.cancelled",
} as const);

export const RETRYABLE_TERM = "retryable";

// Página «Intentos»: tipos de intento, el estado que no es de una llamada, los papeles que se guardan y dos casos
export const ATTEMPT_TERM = Object.freeze({
	runScript: "attempt.run_script",
	buildStep: "attempt.build_step",
	capture: "attempt.capture",
	contractError: "attempt.contract_error",
	lastStatus: "attempt.last_status",
	hashOnly: "attempt.hash_only",
	codeTarget: "attempt.code",
	role: Object.freeze({
		step: "attempt.role.step",
		params: "attempt.role.params",
		kit: "attempt.role.kit",
		hooks: "attempt.role.hooks",
		screens: "attempt.role.screens",
		map: "attempt.role.map",
		plan: "attempt.role.plan",
		recognize: "attempt.role.recognize",
	}),
} as const);

export const ID_TERM = Object.freeze({
	session: "id.session",
	call: "id.call",
	job: "id.job",
	node: "id.node",
} as const);

export const METRIC_TERM = Object.freeze({
	calls: "metric.calls",
	writes: "metric.writes",
	errors: "metric.errors",
	running: "metric.running",
	meanDuration: "metric.meanDuration",
	p95: "metric.p95",
	nodesTouched: "metric.nodesTouched",
} as const);

export const COLUMN_TERM = Object.freeze({
	time: "col.time",
	tool: "col.tool",
	job: "col.job",
	status: "col.status",
	duration: "col.duration",
	nodes: "col.nodes",
	session: "col.session",
} as const);

export const CONNECTION_TERM = Object.freeze({
	panel: "conn.panel",
	chrome: "conn.chrome",
	figma: "conn.figma",
	agent: "conn.agent",
} as const);

export const TERMS: readonly Term[] = [
	// Estados
	{
		key: STATUS_TERM.ok,
		label: "Correcto",
		short: "La llamada terminó sin error.",
		group: "status",
	},
	{
		key: STATUS_TERM.running,
		label: "En curso",
		short: "La llamada o el job aún no ha terminado.",
		group: "status",
	},
	{
		key: STATUS_TERM.error,
		label: "Error",
		short: "La llamada falló. En la tabla, la etiqueta dice el tipo de error.",
		long: "Abre la fila para ver el mensaje, la línea del script y el siguiente paso recomendado.",
		group: "status",
	},
	{
		key: STATUS_TERM.jobRunning,
		label: "Job en curso",
		short: "El script superó el plazo blando y sigue ejecutándose en Figma.",
		long: "Claude lo consulta con figma_get_job. Hasta que termine, no se sabe qué nodos tocó.",
		group: "status",
	},
	{
		key: STATUS_TERM.jobDone,
		label: "Job terminado",
		short: "El script largo acabó bien; su resultado está en disco.",
		group: "status",
	},
	{
		key: STATUS_TERM.jobFailed,
		label: "Job fallido",
		short: "El script largo terminó con un error.",
		group: "status",
	},
	{
		key: STATUS_TERM.jobCancelled,
		label: "Job cancelado",
		short:
			"Se canceló el lote: el paso en curso acabó y los siguientes no se lanzaron.",
		long: "Lo pidió el usuario, no es un fallo. El estado final cuenta qué pasos se hicieron y qué nodos se tocaron.",
		group: "status",
	},
	{
		key: STEP_STATUS_TERM.pending,
		label: "Paso pendiente",
		short: "El paso del lote todavía no ha empezado.",
		group: "status",
	},
	{
		key: STEP_STATUS_TERM.running,
		label: "Paso en curso",
		short: "El paso del lote se está ejecutando ahora en Figma.",
		group: "status",
	},
	{
		key: STEP_STATUS_TERM.done,
		label: "Paso hecho",
		short: "El paso del lote terminó sin error.",
		group: "status",
	},
	{
		key: STEP_STATUS_TERM.failed,
		label: "Paso fallido",
		short: "El paso del lote falló; su error trae el fichero y la línea.",
		group: "status",
	},
	{
		key: STEP_STATUS_TERM.skipped,
		label: "Paso omitido",
		short:
			"El paso no se ejecutó por reanudar el lote desde un paso posterior (fromStep).",
		group: "status",
	},
	{
		key: STEP_STATUS_TERM.cancelled,
		label: "Paso cancelado",
		short: "El paso no llegó a empezar porque se canceló el lote antes.",
		group: "status",
	},
	// Errores
	{
		key: "ChromeUnreachable",
		label: "Chrome no responde",
		short:
			"El servidor no pudo conectar con Chrome por el puerto de depuración.",
		long: "Chrome no está arrancado con el puerto de depuración, o el puerto de .env no coincide. Arráncalo con make chrome y repite la llamada.",
		group: "errors",
	},
	{
		key: "FigmaTabNotFound",
		label: "Sin pestaña de Figma",
		short:
			"Chrome responde, pero ninguna pestaña tiene abierto el archivo configurado.",
		long: "Abre la URL del archivo del proyecto (la de la página «Proyectos») en el Chrome de depuración.",
		group: "errors",
	},
	{
		key: "FigmaNotReady",
		label: "Figma no está listo",
		short: "La pestaña existe, pero el objeto figma aún no está disponible.",
		long: "Tres causas, que figma_status distingue: el editor aún carga (espera), no hay sesión de Figma (make login) o tu cuenta solo puede ver el archivo (pide permiso de edición o usa un duplicado).",
		group: "errors",
	},
	{
		key: "ScriptReadError",
		label: "Script ilegible",
		short:
			"No se pudo leer el archivo del script: no existe o está fuera de FCC_SCRIPTS_ROOT.",
		group: "errors",
	},
	{
		key: "ScriptError",
		label: "Error en el script",
		short:
			"El script falló dentro de Figma; el mensaje trae la línea del script.",
		long: "Ni la sintaxis ni la excepción son reintentables tal cual: corrige el script. Un error de ejecución puede haber dejado cambios a medias: revisa el lienzo antes de repetir.",
		group: "errors",
	},
	{
		key: "NodeNotFound",
		label: "Nodo inexistente",
		short: "El id que pediste no existe en el archivo.",
		long: "Comprueba el id con figma_metadata (sin nodeId devuelve la página actual). Repetir la misma llamada da el mismo error.",
		group: "errors",
	},
	{
		key: "Timeout",
		label: "Tiempo agotado",
		short: "La llamada a Chrome superó el tiempo máximo y se abandonó.",
		long: "El script puede seguir ejecutándose en Figma: consulta el job o revisa el lienzo antes de reintentar.",
		group: "errors",
	},
	{
		key: "Interrupted",
		label: "Interrumpido",
		short:
			"El servidor MCP se apagó con el job en marcha: no se sabe cómo acabó.",
		long: "Figma no deja interrumpir un script en marcha, así que el script pudo seguir o terminar en Figma y el servidor no puede saberlo. Mira el lienzo con figma_metadata antes de repetirlo. Para un script largo, trocéalo en pasos con figma_build: se puede cancelar y se sabe en cuál se cortó.",
		group: "errors",
	},
	{
		key: "UsageError",
		label: "Uso incorrecto",
		short:
			"La herramienta recibió argumentos no válidos o una combinación que no admite.",
		group: "errors",
	},
	{
		key: "UnexpectedError",
		label: "Error inesperado",
		short: "Fallo del propio servidor, no de Figma: es un bug.",
		long: "El mensaje y el stderr del servidor MCP dan la pista.",
		group: "errors",
	},
	{
		key: RETRYABLE_TERM,
		label: "Reintentable",
		short:
			"Repetir la misma llamada puede funcionar, por ejemplo tras arrancar Chrome.",
		group: "errors",
	},
	// Identificadores
	{
		key: ID_TERM.session,
		label: "Id de sesión",
		short:
			"Identifica una sesión de Claude Code. Se abrevia a sus 8 primeros caracteres.",
		long: "Cada vez que Claude Code arranca el servidor MCP nace una sesión nueva. El histórico guarda el id completo.",
		group: "ids",
	},
	{
		key: ID_TERM.call,
		label: "Id de llamada",
		short:
			"Identifica una llamada a una herramienta. Se abrevia a sus 8 primeros caracteres.",
		long: "figma_history_call recibe el id completo.",
		group: "ids",
	},
	{
		key: ID_TERM.job,
		label: "Id de job",
		short:
			"Identifica un script largo que sigue ejecutándose. Se abrevia a 8 caracteres.",
		group: "ids",
	},
	{
		key: ID_TERM.node,
		label: "Id de nodo de Figma",
		short: "Formato 1234:5678. Púlsalo para abrir ese nodo en Figma.",
		long: "Es el identificador interno de una capa del archivo. En la URL de Figma viaja como 1234-5678.",
		group: "ids",
	},
	// Métricas
	{
		key: METRIC_TERM.calls,
		label: "Llamadas",
		short: "Cuántas veces se llamó a una herramienta de Figma Control Center.",
		group: "metrics",
	},
	{
		key: METRIC_TERM.writes,
		label: "Escrituras",
		short: "Llamadas que modifican el archivo de Figma (los scripts).",
		group: "metrics",
	},
	{
		key: METRIC_TERM.errors,
		label: "Errores",
		short: "Llamadas que terminaron con error, y su porcentaje del total.",
		group: "metrics",
	},
	{
		key: METRIC_TERM.running,
		label: "En curso",
		short: "Llamadas o jobs que todavía no han terminado.",
		group: "metrics",
	},
	{
		key: METRIC_TERM.meanDuration,
		label: "Duración media",
		short: "Media de las llamadas terminadas.",
		group: "metrics",
	},
	{
		key: METRIC_TERM.p95,
		label: "p95",
		short:
			"El 95 % de las llamadas tardó eso o menos: enseña la cola lenta que la media esconde.",
		group: "metrics",
	},
	{
		key: METRIC_TERM.nodesTouched,
		label: "Nodos tocados",
		short: "Nodos de Figma distintos que tocaron las llamadas y los jobs.",
		group: "metrics",
	},
	// Herramientas
	{
		key: "figma_run_script",
		label: "figma_run_script",
		short:
			"Ejecuta un script del API de plugins en Figma. Es la única que modifica el archivo.",
		long: "Si el script pasa del plazo blando devuelve un job y sigue ejecutándose.",
		group: "tools",
	},
	{
		key: "figma_build",
		label: "figma_build",
		short:
			"Ejecuta un lote de pasos (un script por paso) en orden, con progreso y cancelación.",
		long: "Modifica el archivo. Recibe un manifiesto, una lista corta de pasos (de script o del kit, incluidos el que pinta una pantalla y el que pinta una hoja de componente, ambos desde su captura, y el que revisa la maquetación de un área sin escribir nada) los nombres de áreas del proyecto (que pintan antes las pantallas con captura) o las claves de hojas de componentes (un paso por hoja, en el orden de sheets@1; una hoja ya hecha se rehace sobre su mismo set y una sin captura válida queda fuera y se avisa), y devuelve su progreso.",
		group: "tools",
	},
	{
		key: "figma_cancel_job",
		label: "figma_cancel_job",
		short:
			"Cancela un lote entre pasos: el paso en curso termina y no empieza el siguiente.",
		group: "tools",
	},
	{
		key: "figma_get_job",
		label: "figma_get_job",
		short: "Consulta el estado y el resultado de un script largo.",
		group: "tools",
	},
	{
		key: "figma_status",
		label: "figma_status",
		short:
			"Diagnóstico: Chrome, pestaña, objeto figma, archivo y página abiertos.",
		group: "tools",
	},
	{
		key: "figma_screenshot",
		label: "figma_screenshot",
		short: "Guarda un PNG de un nodo y devuelve su ruta y dimensiones.",
		group: "tools",
	},
	{
		key: "figma_metadata",
		label: "figma_metadata",
		short: "Árbol ligero de capas (id, nombre, tipo) de un nodo.",
		group: "tools",
	},
	{
		key: "figma_variables",
		label: "figma_variables",
		short:
			"Lee las variables del archivo (colecciones, modos, valores y alias) y las deja en un JSON.",
		long: "Solo lectura. El JSON completo va a reads/ de la carpeta de salida del proyecto; la respuesta trae su ruta y unos conteos. Con nodeId, solo las variables ligadas en ese nodo y dónde.",
		group: "tools",
	},
	{
		key: "figma_styles",
		label: "figma_styles",
		short:
			"Lee los estilos locales (pintura, texto, efecto, retícula) y los deja en un JSON.",
		long: "Solo lectura. Cada estilo con su valor corto y sus variables ligadas; el JSON va a reads/ y la respuesta trae su ruta y cuántos hay de cada tipo.",
		group: "tools",
	},
	{
		key: "figma_components",
		label: "figma_components",
		short:
			"Catálogo de componentes del archivo: sets con sus variantes y propiedades, y componentes sueltos.",
		long: "Solo lectura. Filtra por página o por texto en el nombre; el JSON va a reads/ y la respuesta trae su ruta y los conteos.",
		group: "tools",
	},
	{
		key: "figma_instances",
		label: "figma_instances",
		short:
			"Cuenta las instancias de cada frame de primer nivel de las páginas pedidas, por set o componente.",
		long: "Solo lectura. No cuenta lo oculto dentro de instancias. Con un lote en marcha puede ver una pantalla a medio construir. El JSON va a reads/.",
		group: "tools",
	},
	{
		key: "figma_export",
		label: "figma_export",
		short:
			"Exporta nodos a PNG, JPG, SVG o PDF: un fichero por nodo en exports/ y un índice en reads/.",
		long: "Solo lectura del archivo. Tiene un tope de nodos por llamada (ajuste «Nodos por exportación»). Las exportaciones no salen en Capturas: para revisar a ojo está figma_screenshot.",
		group: "tools",
	},
	{
		key: "figma_design_context",
		label: "figma_design_context",
		short:
			"Diseño a código: lee un nodo de Figma y deja su contexto (árbol, auto-layout, variables, estilos e instancias con su plantilla) en un JSON.",
		long: "Solo lectura. No genera código: da los datos para escribir o actualizar la plantilla 1 a 1. Cada valor ligado sale con su variable o estilo; lo que no, como valor suelto. Cada componente lleva su hoja y su plantilla, o el aviso NO_CODE_MAPPING. Con un set de componentes recorre una sola variante. Saca también la captura del nodo (sale en Capturas). El JSON va a reads/ y el tope de nodos es el ajuste «Nodos por contexto de diseño».",
		group: "tools",
	},
	{
		key: "figma_capture",
		label: "figma_capture",
		short:
			"Captura pantallas de la web del proyecto en un Chrome aparte y deja cada captura de la web en web-captures/.",
		long: "No toca Figma. Lee la configuración del proyecto (figma-control-center.json), entra con su usuario de prueba si la pantalla lo pide y juzga cada captura con el contrato capture@1: la que no lo cumple va a rejected/ con sus errores. La respuesta trae solo un resumen; pide permiso porque abre un navegador e inicia sesión. No sale en Capturas.",
		group: "tools",
	},
	{
		key: "figma_history_summary",
		label: "figma_history_summary",
		short:
			"Resumen de un rango: llamadas, errores, duración y herramientas más usadas.",
		group: "tools",
	},
	{
		key: "figma_history_errors",
		label: "figma_history_errors",
		short:
			"Errores de un rango agrupados por tipo, con su siguiente paso y ejemplos.",
		group: "tools",
	},
	{
		key: "figma_history_nodes",
		label: "figma_history_nodes",
		short: "Nodos de Figma tocados y por cuántas llamadas.",
		group: "tools",
	},
	{
		key: "figma_history_sessions",
		label: "figma_history_sessions",
		short: "Sesiones de Claude Code con sus contadores de toda la vida.",
		group: "tools",
	},
	{
		key: "figma_history_search",
		label: "figma_history_search",
		short:
			"Busca llamadas por texto: ruta de script, herramienta, error o id de nodo.",
		group: "tools",
	},
	{
		key: "figma_history_call",
		label: "figma_history_call",
		short: "Detalle completo de una llamada a partir de su id.",
		group: "tools",
	},
	{
		key: "figma_history_attempts",
		label: "figma_history_attempts",
		short:
			"Los intentos de un script o una pantalla: cuántas veces se ejecutó, cómo acabó cada vez y qué cambió entre una y otra.",
		group: "tools",
	},
	{
		key: "figma_history_script",
		label: "figma_history_script",
		short:
			"Deja en la carpeta de salida el contenido exacto que usó un intento (el script, sus params o el kit) para poder leerlo.",
		group: "tools",
	},
	{
		key: "figma_history_diff",
		label: "figma_history_diff",
		short:
			"Compara dos intentos del mismo objetivo: qué papeles cambiaron, cuántas líneas y el diff de uno; el diff entero queda en un fichero.",
		group: "tools",
	},
	{
		key: "figma_chat_reply",
		label: "figma_chat_reply",
		short: "La respuesta de Claude a un mensaje del chat de este panel.",
		group: "tools",
	},
	// Intentos
	{
		key: ATTEMPT_TERM.runScript,
		label: "Script",
		short:
			"Un figma_run_script: ejecuta un script, o un `code` suelto, en Figma.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.buildStep,
		label: "Paso de lote",
		short:
			"Un paso de un lote (figma_build): un script o un paso del kit, como kit/place@1.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.capture,
		label: "Captura",
		short: "Una pantalla de la web capturada con figma_capture.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.contractError,
		label: "Contrato incumplido",
		short:
			"El script se ejecutó, pero su resultado no cumple el @contract que declara.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.lastStatus,
		label: "Último estado",
		short:
			"Cómo acabó el último intento del objetivo: correcto, error o contrato incumplido. También es un filtro.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.hashOnly,
		label: "Solo hash",
		short:
			"El contenido pasó de FCC_SCRIPT_MAX_BYTES: solo se guardó su hash y su tamaño, no se puede comparar.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.codeTarget,
		label: "(código)",
		short:
			"Objetivo de los `code` sueltos: todos comparten número de intento. No es un fichero.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.step,
		label: "Script",
		short: "El script, o el módulo, que se ejecutó en ese intento.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.params,
		label: "Parámetros",
		short: "Los parámetros que recibió el script, como JSON.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.kit,
		label: "Kit",
		short:
			"El kit (figma-kit o capture-kit) que estaba instalado cuando se ejecutó.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.hooks,
		label: "Ganchos",
		short: "El módulo de ganchos de la captura (ready, ignore…).",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.screens,
		label: "Pantallas",
		short: "La entrada screens@1 de la pantalla capturada.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.map,
		label: "Mapa",
		short: "El map@1 de la pantalla: qué componente de Figma pinta cada trozo.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.plan,
		label: "Plan",
		short: "El plan screen@1 con el que se pintó la pantalla.",
		group: "attempts",
	},
	{
		key: ATTEMPT_TERM.role.recognize,
		label: "Reconocimiento",
		short: "El módulo recognize@1 que decide qué componente es cada elemento.",
		group: "attempts",
	},
	// Columnas y filtros
	{
		key: COLUMN_TERM.time,
		label: "Hora",
		short: "Cuándo se lanzó la llamada (hora local).",
		group: "columns",
	},
	{
		key: COLUMN_TERM.tool,
		label: "Herramienta",
		short:
			"La herramienta llamada y, debajo, el argumento que dice sobre qué trabajó.",
		group: "columns",
	},
	{
		key: COLUMN_TERM.job,
		label: "Job",
		short: "Id abreviado del script largo que lanzó la llamada.",
		group: "columns",
	},
	{
		key: COLUMN_TERM.status,
		label: "Resultado",
		short:
			"Cómo terminó: correcto, en curso o el tipo de error. También es un filtro.",
		group: "columns",
	},
	{
		key: COLUMN_TERM.duration,
		label: "Duración",
		short: "Lo que tardó la llamada; en blanco mientras sigue en curso.",
		group: "columns",
	},
	{
		key: COLUMN_TERM.nodes,
		label: "Nodos",
		short: "Cuántos nodos de Figma tocó la llamada (y su job).",
		group: "columns",
	},
	{
		key: COLUMN_TERM.session,
		label: "Sesión",
		short:
			"La sesión de Claude Code que hizo la llamada. También es un filtro.",
		group: "columns",
	},
	// Conexión
	{
		key: CONNECTION_TERM.panel,
		label: "Panel",
		short: "La conexión en vivo de esta página con el servidor del panel.",
		group: "connection",
	},
	{
		key: CONNECTION_TERM.chrome,
		label: "Chrome",
		short: "El Chrome con puerto de depuración por el que se controla Figma.",
		group: "connection",
	},
	{
		key: CONNECTION_TERM.figma,
		label: "Figma",
		short:
			"La pestaña del archivo, según la última comprobación del agente (figma_status): el panel no mira Chrome por su cuenta.",
		group: "connection",
	},
	{
		key: CONNECTION_TERM.agent,
		label: "Agente",
		short: "Una sesión de Claude Code que escucha el chat de este panel.",
		group: "connection",
	},
];

const BY_KEY: ReadonlyMap<string, Term> = new Map(TERMS.map((t) => [t.key, t]));

export const termOf = (key: string): Term | null => BY_KEY.get(key) ?? null;
