// Lo que comparten los tests del kit de captura (D-5: `make e2e`, nunca `make check`): las páginas de ejemplo servidas
// en local (server/test/fixtures/capture/), el Chromium de Playwright lanzado por el test (sin puerto de depuración,
// nunca el Chrome del usuario ni el del 9222) y el kit empaquetado instalado en la página.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { CAPTURE_KIT_BUNDLE, REPO_ROOT } from "../build.ts";

export const FIXTURES_DIR = join(REPO_ROOT, "server/test/fixtures/capture");
// Una ruta /lento/<ms>/<fichero> sirve el fichero tras esperar esos ms (imágenes que tardan)
const SLOW = /^\/lento\/(\d+)(\/.+)$/;
const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".js": "text/javascript",
};
export const VIEWPORT = { width: 800, height: 600 } as const;

export type Site = {
	readonly url: string;
	readonly close: () => Promise<void>;
};

export async function serveFixtures(dir = FIXTURES_DIR): Promise<Site> {
	const server: Server = createServer((req, res) => {
		void (async () => {
			let path = new URL(req.url ?? "/", "http://x").pathname;
			const slow = SLOW.exec(path);
			if (slow) {
				await new Promise((r) => setTimeout(r, Number(slow[1])));
				path = slow[2] as string;
			}
			const file = normalize(join(dir, path));
			if (!file.startsWith(dir)) {
				res.writeHead(403).end();
				return;
			}
			try {
				const body = await readFile(file);
				res.writeHead(200, {
					"Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
				});
				res.end(body);
			} catch {
				res.writeHead(404).end();
			}
		})();
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise((r) => server.close(() => r())),
	};
}

export const launchBrowser = (): Promise<Browser> => chromium.launch();

// Abre una página de ejemplo e instala el kit empaquetado (el mismo fichero que lee el servidor)
export async function openWithKit(
	browser: Browser,
	url: string,
): Promise<Page> {
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
	});
	await page.goto(url, { waitUntil: "load" });
	await page.addScriptTag({
		content: await readFile(CAPTURE_KIT_BUNDLE, "utf8"),
	});
	return page;
}

export type KitNode = Record<string, unknown> & {
	readonly path: string;
	readonly kids?: readonly KitNode[];
};

const TARGET = {
	screen: { key: "ejemplo", title: "Ejemplo", url: "/" },
	variant: { props: {} },
	allowPageWorld: false,
};

// ready (settle → gancho ready → strip) y capture, como el capturador de serie; devuelve los nodos por ruta
export async function capture(
	page: Page,
	options: {
		strip?: string[];
		hideScrollbar?: boolean;
		pick?: string;
		hooks?: string;
	} = {},
): Promise<{
	readonly byPath: ReadonlyMap<string, KitNode>;
	readonly warnings: unknown[];
}> {
	const raw = (await page.evaluate(`(async () => {
		const kit = window.__figmaCaptureKit;
		${options.hooks === undefined ? "" : `const problem = kit.useHooks(${options.hooks}); if (problem) throw new Error(problem);`}
		const target = ${JSON.stringify(TARGET)};
		const ready = await kit.ready({ ...target, strip: ${JSON.stringify(options.strip ?? [])}, hideScrollbar: ${options.hideScrollbar === true}, imgTimeoutMs: 5000 });
		const out = await kit.capture({ ...target, imgHi: true${options.pick === undefined ? "" : `, pick: ${JSON.stringify(options.pick)}`} });
		return JSON.stringify({ nodes: out.nodes, warnings: [...ready.warnings, ...out.warnings] });
	})()`)) as string;
	const { nodes, warnings } = JSON.parse(raw) as {
		nodes: KitNode[];
		warnings: unknown[];
	};
	const byPath = new Map<string, KitNode>();
	const visit = (n: KitNode) => {
		byPath.set(n.path, n);
		for (const k of n.kids ?? []) visit(k);
	};
	for (const n of nodes) visit(n);
	return { byPath, warnings };
}

// El fragmento esperado de capture@1 (por ruta): cada clave tiene que valer lo mismo; un RegExp casa con un texto; null
// en vez de un nodo = esa ruta no se captura
export type Fragment = Readonly<
	Record<string, Readonly<Record<string, unknown>> | null>
>;

function matches(actual: unknown, expected: unknown, where: string): void {
	if (expected instanceof RegExp) {
		assert.match(String(actual), expected, where);
	} else if (
		expected !== null &&
		typeof expected === "object" &&
		!Array.isArray(expected)
	) {
		assert.ok(
			actual !== null && typeof actual === "object",
			`${where}: no es un objeto`,
		);
		for (const [k, v] of Object.entries(expected))
			matches((actual as Record<string, unknown>)[k], v, `${where}.${k}`);
	} else {
		assert.deepEqual(actual, expected, where);
	}
}

export function assertFragment(
	byPath: ReadonlyMap<string, KitNode>,
	expected: Fragment,
): void {
	for (const [path, node] of Object.entries(expected)) {
		if (node === null) {
			assert.equal(byPath.has(path), false, `${path} no debería capturarse`);
			continue;
		}
		const got = byPath.get(path);
		assert.ok(got, `falta ${path}; hay: ${[...byPath.keys()].join(", ")}`);
		matches(got, node, path);
	}
}
