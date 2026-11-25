// Contrato del lanzamiento del agente desde el panel. Sin imports, como chat.ts, para que la web lo comparta
// con `import type`.

// Un lanzamiento se sigue por sesión, no por proceso: el cliente de la terminal sale al instante y su pid no
// dice nada. El lanzamiento termina cuando una sesión NUEVA publica su token o vence `timeoutMs`
export type AgentLaunched = {
	readonly launchId: string;
	// ISO 8601 UTC
	readonly startedAt: string;
	// Cuánto espera el servidor (y debe esperar la interfaz) a que aparezca la sesión
	readonly timeoutMs: number;
};

export type AgentLaunchError = {
	readonly type:
		| "LaunchInProgress"
		| "TerminalNotFound"
		| "LaunchFailed"
		// El id de proyecto no tiene forma de id (nunca llega a la orden)
		| "InvalidProject"
		// Sin proyecto no se lanza: un agente nunca ve todos los proyectos
		| "ProjectRequired"
		// El proyecto ya no está en el registro
		| "ProjectNotAvailable"
		// Una raíz del proyecto es peligrosa (raíz del sistema, home, repo, solape…): el mensaje dice cuál y por qué
		| "UnsafeProjectPaths";
	readonly message: string;
};

// Un agente lanzado desde el panel que sigue vivo y vigilando al panel: el que el botón «Cerrar agente» puede cerrar
// (GET /api/agent/launches?project=<id>)
export type AgentWatching = { readonly launchId: string };

export type CloseAgentError = {
	readonly type: // El lanzamiento no existe o su lanzador ya no vive
		| "UnknownLaunch"
		// Vive, pero no tiene abierta la vigilancia (el panel no tiene por dónde pedirle que se cierre)
		| "AgentNotWatching";
	readonly message: string;
};
