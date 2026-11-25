// El lado de agent-run.ts de la vigilancia del panel: una conexión GET que se deja abierta.
// El panel no manda nada mientras vive; si muere, el sistema cierra el socket y aquí se ve al instante. No escribe en
// stdout ni en stderr (la terminal es de `claude`): solo avisa a quien la abrió. Un intento por llamada; reintentar es
// cosa de quien llama (la regla está en domain/agent-watch.ts).
import { request } from "node:http";
import { AGENT_ROUTE, AGENT_WATCH } from "./routes.ts";

const HTTP_OK = 200;
const JSON_TYPE = "application/json";

export type PanelWatchHandlers = {
	// La conexión está abierta y el panel reconoce el lanzamiento
	readonly onConnected: () => void;
	// Se cayó, no se pudo abrir o el panel no reconoce el lanzamiento
	readonly onLost: () => void;
	// El panel mandó el evento `close` (botón «Cerrar agente»)
	readonly onClose: () => void;
};

export function watchPanel(
	options: {
		readonly host: string;
		readonly port: number;
		readonly launchId: string;
	},
	handlers: PanelWatchHandlers,
): { readonly cancel: () => void } {
	// Un solo final por intento: perdida, cerrada por el panel o cancelada
	let done = false;
	const finish = (notify: (() => void) | null): void => {
		if (done) return;
		done = true;
		notify?.();
	};
	const path = `${AGENT_ROUTE.watch}?${new URLSearchParams({ [AGENT_WATCH.launchParam]: options.launchId })}`;
	const closeMarker = `event: ${AGENT_WATCH.closeEvent}\n`;
	const req = request(
		{
			host: options.host,
			port: options.port,
			path,
			method: "GET",
			headers: { "Content-Type": JSON_TYPE },
		},
		(res) => {
			if (res.statusCode !== HTTP_OK) {
				res.resume();
				finish(handlers.onLost);
				return;
			}
			if (!done) handlers.onConnected();
			let received = "";
			res.setEncoding("utf8");
			res.on("data", (chunk: string) => {
				received += chunk;
				if (received.includes(closeMarker)) finish(handlers.onClose);
			});
			res.on("close", () => finish(handlers.onLost));
		},
	);
	req.on("error", () => finish(handlers.onLost));
	req.on("close", () => finish(handlers.onLost));
	req.end();
	return {
		cancel: () => {
			finish(null);
			req.destroy();
		},
	};
}
