// Construye el panel (Svelte + TS + Tailwind) en web/dist y lo sirve en desarrollo con recarga en caliente.
// La misma configuración la usa Vitest (`test`): build y tests compilan igual. Vitest solo ve web/; server/ es de node:test.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { build, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { EVENTS_PATH, SCREENSHOTS_PATH } from "./src/lib/activity/endpoints.ts";

const WEB_ROOT = import.meta.dirname;
const REPO_ROOT = resolve(WEB_ROOT, "..");
const TARGET = "es2022";

// Nombres fijos (sin hash): el panel y los E2E sirven y enlazan estos
const OUT = Object.freeze({
	js: "app.js",
	css: "app.css",
	themeInit: "theme-init.js",
	otherAssets: "assets/[name]-[hash][extname]",
} as const);

// Lo que la web pide al panel: API, flujo SSE y capturas
const API_PREFIX = "/api/";
const PANEL_ROUTES = [API_PREFIX, EVENTS_PATH, SCREENSHOTS_PATH] as const;

// make dev-web los pone desde .env con los valores por defecto de schema.ts (spikes/m0/env.sh)
const PANEL_ENV = Object.freeze({
	host: "FCC_DASHBOARD_HOST",
	port: "FCC_DASHBOARD_PORT",
} as const);

// theme-init es un script clásico (no módulo) que fija el tema antes del primer pintado: va en su propio bundle IIFE
async function bundleThemeInit(minify: boolean): Promise<string> {
	const output = await build({
		configFile: false,
		root: WEB_ROOT,
		logLevel: "silent",
		build: {
			write: false,
			target: TARGET,
			minify,
			rolldownOptions: {
				input: join(WEB_ROOT, "src/theme-init.ts"),
				output: { format: "iife", entryFileNames: OUT.themeInit },
			},
		},
	});
	const [result] = Array.isArray(output) ? output : [output];
	const chunk = result && "output" in result ? result.output[0] : undefined;
	if (chunk?.type !== "chunk") throw new Error("theme-init no generó código");
	return chunk.code;
}

function themeInit(): Plugin {
	let minify = true;
	return {
		name: "figma-theme-init",
		configResolved(config) {
			minify = config.build.minify !== false;
		},
		transformIndexHtml: () => [
			{ tag: "script", attrs: { src: `/${OUT.themeInit}` }, injectTo: "head" },
		],
		configureServer(server) {
			server.middlewares.use(`/${OUT.themeInit}`, (_req, res, next) => {
				bundleThemeInit(false).then((code) => {
					res.setHeader("Content-Type", "text/javascript; charset=utf-8");
					res.end(code);
				}, next);
			});
		},
		async generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: OUT.themeInit,
				source: await bundleThemeInit(minify),
			});
		},
	};
}

// Solo el servidor de desarrollo (no el build, ni Vitest, ni svelte-check, que también cargan esta configuración)
function panelProxy(env: NodeJS.ProcessEnv): Plugin {
	const host = env[PANEL_ENV.host];
	const port = env[PANEL_ENV.port];
	const configured = Boolean(host && port);
	// changeOrigin: el panel solo atiende su propio Host (DNS rebinding)
	const target = { target: `http://${host}:${port}`, changeOrigin: true };
	return {
		name: "figma-panel-proxy",
		apply: (_config, { command, mode }) =>
			command === "serve" && mode !== "test",
		config: () =>
			configured
				? {
						server: {
							proxy: Object.fromEntries(
								PANEL_ROUTES.map((route) => [route, target]),
							),
							// Solo sirve web/ (Vitest, que también es un servidor, necesita node_modules)
							fs: { allow: [WEB_ROOT] },
						},
					}
				: {},
		configureServer() {
			if (!configured)
				throw new Error(
					`Faltan ${PANEL_ENV.host} y ${PANEL_ENV.port}: arranca con «make dev-web».`,
				);
		},
	};
}

// Versión y repositorio del panel, de package.json al compilar (también en Vitest): ningún componente los escribe a mano
type PackageInfo = { version: string; repository: { url: string } };
const PACKAGE = JSON.parse(
	readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
) as PackageInfo;
// git+https://github.com/x/y.git → https://github.com/x/y
const repositoryPage = (url: string): string =>
	url.replace(/^git\+/, "").replace(/\.git$/, "");

const assetName = (names: readonly string[]): string => {
	const [name = ""] = names;
	if (name.endsWith(".css")) return OUT.css;
	return OUT.otherAssets;
};

export default defineConfig({
	root: WEB_ROOT,
	// La caché de dependencias, con el resto de node_modules (no en web/)
	cacheDir: join(REPO_ROOT, "node_modules/.vite"),
	define: {
		__APP_VERSION__: JSON.stringify(PACKAGE.version),
		__APP_REPOSITORY__: JSON.stringify(repositoryPage(PACKAGE.repository.url)),
	},
	// Los estilos de cada componente van dentro del JS, como hasta ahora
	plugins: [
		tailwindcss(),
		svelte({ configFile: false, emitCss: false }),
		themeInit(),
		panelProxy(process.env),
		svelteTesting({ autoCleanup: false }),
	],
	build: {
		outDir: join(WEB_ROOT, "dist"),
		emptyOutDir: true,
		target: TARGET,
		cssCodeSplit: false,
		modulePreload: { polyfill: false },
		rolldownOptions: {
			output: {
				entryFileNames: OUT.js,
				assetFileNames: (info) => assetName(info.names),
			},
		},
	},
	// Entorno node por defecto; un test de componente pide happy-dom en su cabecera (@vitest-environment)
	test: {
		include: ["src/**/*.test.ts", "test/**/*.test.ts"],
		// Su caché, con la de Vite en node_modules de la raíz (no en web/)
		fsModuleCachePath: join(REPO_ROOT, "node_modules/.vitest-cache"),
		coverage: { include: ["src/**"], reporter: ["text"] },
	},
});
