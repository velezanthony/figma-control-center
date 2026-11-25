// Panel FALSO para las pruebas de la vigilancia del agente: solo sirve GET /api/agent/watch como
// el de verdad (cabeceras y nada más mientras vive; un evento `close` si se le pide) en un puerto libre de loopback,
// nunca el del panel del dueño. Puede morir (cierra el servidor y corta los sockets, como un kill -9) y volver en el
// mismo puerto.
import { createServer, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { AGENT_ROUTE, AGENT_WATCH } from "#adapters/http/routes.ts";
import { LOOPBACK } from "./env.ts";
import { freePort } from "./wait.ts";

export type FakePanelRequest = {
	readonly method: string;
	readonly url: string;
	readonly headers: Readonly<Record<string, string | string[] | undefined>>;
};

export type FakePanel = {
	readonly port: number;
	// Todas las peticiones que le llegaron (vivo o tras volver)
	readonly requests: FakePanelRequest[];
	// Conexiones de vigilancia abiertas ahora
	open(): number;
	// Manda el evento `close` por las conexiones abiertas de ese lanzamiento (el botón «Cerrar agente»)
	sendClose(launchId: string): number;
	// Si se fija, solo reconoce estos lanzamientos (los demás, 404)
	known: ReadonlySet<string> | null;
	die(): Promise<void>;
	revive(): Promise<void>;
	stop(): Promise<void>;
};

export async function startFakePanel(): Promise<FakePanel> {
	const port = await freePort();
	const requests: FakePanelRequest[] = [];
	const watches = new Map<ServerResponse, string>();
	const sockets = new Set<Socket>();
	let server: Server | null = null;

	const panel: FakePanel = {
		port,
		requests,
		known: null,
		open: () => watches.size,
		sendClose: (launchId) => {
			let sent = 0;
			for (const [res, id] of watches) {
				if (id !== launchId) continue;
				res.end(`event: ${AGENT_WATCH.closeEvent}\ndata: {}\n\n`);
				watches.delete(res);
				sent++;
			}
			return sent;
		},
		die: async () => {
			const s = server;
			server = null;
			watches.clear();
			for (const socket of sockets) socket.destroy();
			sockets.clear();
			if (s !== null) await new Promise<void>((r) => s.close(() => r()));
		},
		revive: () => listen(),
		stop: () => panel.die(),
	};

	const listen = (): Promise<void> => {
		const s = createServer((req, res) => {
			requests.push({
				method: req.method ?? "",
				url: req.url ?? "",
				headers: req.headers,
			});
			const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
			const launchId = url.searchParams.get(AGENT_WATCH.launchParam) ?? "";
			const recognized = panel.known === null || panel.known.has(launchId);
			if (url.pathname !== AGENT_ROUTE.watch || !recognized) {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end('{"ok":false}');
				return;
			}
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.flushHeaders();
			watches.set(res, launchId);
			res.on("close", () => watches.delete(res));
		});
		s.on("connection", (socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
		});
		server = s;
		return new Promise((resolve) => s.listen(port, LOOPBACK, resolve));
	};

	await listen();
	return panel;
}
