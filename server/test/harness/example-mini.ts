// `example-mini`: el segundo proyecto de los tests, sin nada de una web real y sin data-* en su HTML.
// Su web se sirve en local (portada pública con menú, aviso de cookies y un enlace que sale; login por formulario con
// cookie; una página privada) y su configuración (figma-control-center.json, screens.json, hooks.js) se copia a la
// carpeta del entorno con la baseUrl de ese servidor.
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import type { EntryDraft } from "#domain/registry.ts";

export const EXAMPLE_MINI_DIR = join(
	import.meta.dirname,
	"../fixtures/projects/example-mini",
);
const WEB_DIR = join(EXAMPLE_MINI_DIR, "web");
export const EXAMPLE_MINI_USER = "lector";
export const EXAMPLE_MINI_SECRET_REF = "example-mini-lector";
// La contraseña de prueba: llega al servidor solo por el fichero de secretos del entorno
export const EXAMPLE_MINI_PASSWORD = "clave-ejemplo-7c1e";
const SESSION_COOKIE = "sesion-ejemplo=1";
const PAGES: Readonly<Record<string, string>> = {
	"/": "index.html",
	"/entrar/": "login.html",
	"/privado/": "private.html",
};
const TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".svg": "image/svg+xml",
};

export type ExampleMini = {
	readonly url: string;
	readonly close: () => Promise<void>;
};

export async function startExampleMini(): Promise<ExampleMini> {
	const send = async (
		res: import("node:http").ServerResponse,
		file: string,
		status = 200,
	) => {
		res.writeHead(status, {
			"Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
		});
		res.end(await readFile(join(WEB_DIR, file)));
	};
	const server: Server = createServer((req, res) => {
		void (async () => {
			const path = new URL(req.url ?? "/", "http://x").pathname;
			if (path === "/entrar/" && req.method === "POST") {
				let body = "";
				for await (const chunk of req) body += String(chunk);
				const form = new URLSearchParams(body);
				if (
					form.get("usuario") === EXAMPLE_MINI_USER &&
					form.get("clave") === EXAMPLE_MINI_PASSWORD
				) {
					res.writeHead(302, {
						Location: "/privado/",
						"Set-Cookie": `${SESSION_COOKIE}; Path=/`,
					});
					res.end();
				} else await send(res, "login.html");
				return;
			}
			if (
				path === "/privado/" &&
				!(req.headers.cookie ?? "").includes(SESSION_COOKIE)
			) {
				res.writeHead(302, { Location: "/entrar/" });
				res.end();
				return;
			}
			// Un «componente»: lo que se ve depende de la query, como la galería de un proyecto (una variante = una query)
			if (path === "/componente/") {
				const query = new URL(req.url ?? "/", "http://x").searchParams;
				const size = query.get("tamano") === "lg" ? 120 : 60;
				res.writeHead(200, { "Content-Type": TYPES[".html"] ?? "" });
				res.end(
					`<!doctype html><meta charset="utf-8"><style>@media (hover:hover){#cmp:hover{background:rgb(0,128,0)}}#cmp:active{background:rgb(128,0,0)}</style><body style="margin:0"><span id="cmp" tabindex="0" class="marca fuerte" style="display:inline-block;width:${size}px;height:24px"></span><script>document.getElementById("cmp").textContent = ${JSON.stringify(query.get("etiqueta") ?? "Marca")} + " " + innerWidth</script>`,
				);
				return;
			}
			const page = PAGES[path];
			const file = page ?? normalize(path).replace(/^\/+/, "");
			if (
				page === undefined &&
				(file.includes("..") || !(file in { "dot.svg": 1 }))
			) {
				res.writeHead(404).end();
				return;
			}
			await send(res, file);
		})();
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

// Copia el proyecto a `projectDir` con la baseUrl de la web servida y devuelve su fila para el registro (su carpeta de
// salida, la de siempre: <FCC_OUTPUT_DIR>/<id>)
export async function exampleMiniProject(
	projectDir: string,
	baseUrl: string,
	fileUrl: string,
): Promise<EntryDraft> {
	await cp(EXAMPLE_MINI_DIR, projectDir, {
		recursive: true,
		filter: (src) => !src.startsWith(WEB_DIR),
	});
	const configFile = join(projectDir, "figma-control-center.json");
	const config = JSON.parse(await readFile(configFile, "utf8")) as {
		web: { baseUrl: string };
	};
	config.web.baseUrl = baseUrl;
	await writeFile(configFile, JSON.stringify(config, null, "\t"));
	return { name: "example-mini", projectDir, fileUrl };
}

// El fichero de secretos del entorno (FCC_WEB_SECRETS_FILE de testEnv)
export const writeSecrets = (
	file: string,
	secrets: Readonly<Record<string, string>>,
) => writeFile(file, JSON.stringify(secrets));
