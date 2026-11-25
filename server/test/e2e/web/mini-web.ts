// Una web local mínima para probar el Chrome de captura (adapters/web): una portada con un enlace que sale de la web,
// un botón que abre un menú y una variable de la app; un login por formulario con cookie y una página privada.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const MINI_USER = "lector";
export const MINI_PASSWORD = "clave-de-prueba-9f3";

const page = (body: string) =>
	`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mini</title></head><body>${body}</body></html>`;

const HOME =
	page(`<main><h1>Portada</h1><a id="fuera" href="http://fuera.invalid/">fuera</a>
<button id="abrir" onclick="document.getElementById('menu').hidden = false">abrir</button>
<ul id="menu" hidden><li>uno</li></ul><a id="interna" href="/otra/">otra</a></main>
<script>window.app = { estado: "listo" };</script>`);
const OTHER = page(`<main><h1>Otra</h1></main>`);
const LOGIN = page(
	`<form method="post" action="/entrar/"><input id="usuario" name="u"><input id="clave" name="p" type="password"><button type="submit">Entrar</button></form>`,
);
// Un «componente» de la galería: su tamaño sale de la query (una variante = una query)
const component = (size: string) =>
	page(
		`<div id="cmp" style="width:${size === "lg" ? 200 : 80}px;height:30px">${size}</div>`,
	);
const PRIVATE = page(`<main><h1>Privado</h1></main>`);

export type MiniWeb = {
	readonly url: string;
	readonly close: () => Promise<void>;
};

export async function startMiniWeb(): Promise<MiniWeb> {
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://x");
		const html = (
			status: number,
			body: string,
			headers: Record<string, string> = {},
		) => {
			res.writeHead(status, {
				"Content-Type": "text/html; charset=utf-8",
				...headers,
			});
			res.end(body);
		};
		if (url.pathname === "/") return html(200, HOME);
		if (url.pathname === "/otra/") return html(200, OTHER);
		if (url.pathname === "/componente/")
			return html(200, component(url.searchParams.get("size") ?? "sm"));
		if (url.pathname === "/entrar/" && req.method === "POST") {
			let body = "";
			req.on("data", (c: Buffer) => {
				body += c.toString();
			});
			req.on("end", () => {
				const form = new URLSearchParams(body);
				if (form.get("u") === MINI_USER && form.get("p") === MINI_PASSWORD)
					html(302, "", {
						Location: "/privado/",
						"Set-Cookie": "sesion=1; Path=/",
					});
				else html(200, LOGIN);
			});
			return;
		}
		if (url.pathname === "/entrar/") return html(200, LOGIN);
		if (url.pathname === "/privado/")
			return (req.headers.cookie ?? "").includes("sesion=1")
				? html(200, PRIVATE)
				: html(302, "", { Location: "/entrar/" });
		html(404, page("no"));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise((r) => {
				server.closeAllConnections();
				server.close(() => r());
			}),
	};
}

// Un puerto libre de la máquina (se abre y se cierra)
export async function freePort(): Promise<number> {
	const s = createServer();
	await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
	const { port } = s.address() as AddressInfo;
	await new Promise((r) => s.close(r));
	return port;
}
