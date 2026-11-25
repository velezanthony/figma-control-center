// El kit empaquetado que lee el servidor (kits/dist/figma-kit.js) corresponde a sus fuentes y se instala solo
//. Las fuentes no usan APIs obsoletas ni guardan `figma` (CA-5).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import {
	AREA_KEY_PREFIX as DOMAIN_AREA_KEY_PREFIX,
	SHARED_KEY_PREFIX as DOMAIN_SHARED_KEY_PREFIX,
} from "#domain/areas.ts";
import {
	SHEET_KEY_PREFIX as DOMAIN_SHEET_KEY_PREFIX,
	SHEET_SCRATCH_KEY_PREFIX as DOMAIN_SHEET_SCRATCH_KEY_PREFIX,
	SHEET_VARIANT_KEY_PREFIX as DOMAIN_SHEET_VARIANT_KEY_PREFIX,
} from "#domain/component-plan.ts";
import {
	COMPOSE_KEY_PREFIX as DOMAIN_COMPOSE_KEY_PREFIX,
	COMPOSE_PAGE_KEY_PREFIX as DOMAIN_COMPOSE_PAGE_KEY_PREFIX,
} from "#domain/compose.ts";
import { NODE_KEY_FIELD, NODE_KEY_NAMESPACE } from "#domain/design-context.ts";
import { FIGMA_KIT } from "#domain/step.ts";
import {
	AREA_KEY_PREFIX,
	COMPOSE_KEY_PREFIX,
	COMPOSE_PAGE_KEY_PREFIX,
	KEY,
	KIT_GLOBAL,
	KIT_SHA_GLOBAL,
	KIT_VERSION,
	NS,
	SHARED_KEY_PREFIX,
	SHEET_KEY_PREFIX,
	SHEET_SCRATCH_KEY_PREFIX,
	SHEET_VARIANT_KEY_PREFIX,
} from "../../../../../kits/figma/types.ts";
import { bundleFigmaKit, FIGMA_KIT_BUNDLE, REPO_ROOT } from "../../build.ts";
import { FakeFigma } from "../fake-figma.ts";

const SOURCES = join(REPO_ROOT, "kits/figma");
// Las fuentes del kit, también las de sus subcarpetas (los pasos van en steps/)
const sources = () =>
	readdirSync(SOURCES, { recursive: true, encoding: "utf8" })
		.filter((f) => f.endsWith(".ts"))
		.map((f) => ({ file: f, text: readFileSync(join(SOURCES, f), "utf8") }));

describe("kit de Figma: empaquetado", () => {
	it("la versión del kit es la que conoce el servidor", () => {
		assert.equal(KIT_VERSION, FIGMA_KIT);
	});

	it("el empaquetado versionado es el que sale de las fuentes (si no: npm run build:kit)", async () => {
		assert.equal(
			readFileSync(FIGMA_KIT_BUNDLE, "utf8"),
			await bundleFigmaKit(),
			"kits/dist/figma-kit.js no corresponde a kits/figma: regenéralo con «npm run build:kit»",
		);
	});

	it("las claves de nodo del kit son las del dominio (el kit no puede importarlas)", () => {
		assert.equal(AREA_KEY_PREFIX, DOMAIN_AREA_KEY_PREFIX);
		assert.equal(SHARED_KEY_PREFIX, DOMAIN_SHARED_KEY_PREFIX);
		assert.equal(SHEET_KEY_PREFIX, DOMAIN_SHEET_KEY_PREFIX);
		assert.equal(SHEET_VARIANT_KEY_PREFIX, DOMAIN_SHEET_VARIANT_KEY_PREFIX);
		assert.equal(SHEET_SCRATCH_KEY_PREFIX, DOMAIN_SHEET_SCRATCH_KEY_PREFIX);
		assert.equal(COMPOSE_KEY_PREFIX, DOMAIN_COMPOSE_KEY_PREFIX);
		assert.equal(COMPOSE_PAGE_KEY_PREFIX, DOMAIN_COMPOSE_PAGE_KEY_PREFIX);
	});

	it("donde el kit guarda la clave de un nodo es donde la lee figma_design_context", () => {
		assert.equal(NS, NODE_KEY_NAMESPACE);
		assert.equal(KEY, NODE_KEY_FIELD);
	});

	it("lleva sourceURL: un error dentro del kit no se confunde con el código del paso", () => {
		assert.match(
			readFileSync(FIGMA_KIT_BUNDLE, "utf8"),
			/\/\/# sourceURL=figma-kit@1\.js\s*$/,
		);
	});

	it("evaluado en una pestaña deja el kit en su global, con el hash que le puso el servidor", () => {
		const context = vm.createContext({ [KIT_SHA_GLOBAL]: "abc123" });
		vm.runInContext(readFileSync(FIGMA_KIT_BUNDLE, "utf8"), context);
		const kit = (
			context as Record<string, { version: string; sha256: string } | undefined>
		)[KIT_GLOBAL];
		assert.equal(kit?.version, FIGMA_KIT);
		assert.equal(kit?.sha256, "abc123");
	});

	it("instalado, el kit usa el `figma` de la pestaña en cada llamada, no uno guardado", async () => {
		const context = vm.createContext({});
		vm.runInContext(readFileSync(FIGMA_KIT_BUNDLE, "utf8"), context);
		const first = new FakeFigma();
		first.page("Uno");
		const second = new FakeFigma();
		second.page("Dos");
		const kit = (
			context as Record<string, { page: { find(n: string): Promise<unknown> } }>
		)[KIT_GLOBAL];
		(context as Record<string, unknown>)["figma"] = first;
		assert.ok(await kit?.page.find("Uno"));
		assert.equal(await kit?.page.find("Dos"), null);
		(context as Record<string, unknown>)["figma"] = second;
		assert.equal(await kit?.page.find("Uno"), null);
		assert.ok(await kit?.page.find("Dos"));
	});
});

describe("fuentes del kit de Figma", () => {
	it("no usan APIs obsoletas: getNodeById, resetOverrides ni .instances (CA-5)", () => {
		for (const { file, text } of sources()) {
			const code = text.replace(/\/\/.*$/gm, "");
			assert.equal(
				/\bgetNodeById\s*\(/.test(code),
				false,
				`${file}: getNodeById`,
			);
			assert.equal(
				/\bresetOverrides\b/.test(code),
				false,
				`${file}: resetOverrides`,
			);
			assert.equal(/\.instances\b/.test(code), false, `${file}: .instances`);
		}
	});

	it("no tienen un `catch` vacío: lo que falla y no para el paso va a un aviso (CA-5)", () => {
		for (const { file, text } of sources()) {
			const code = text.replace(/\/\/.*$/gm, "");
			assert.equal(
				/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(code),
				false,
				`${file}: catch vacío`,
			);
		}
	});

	it("no guardan `figma` al cargarse: solo lo leen de globalThis dentro de una función", () => {
		for (const { file, text } of sources()) {
			const code = text.replace(/\/\/.*$/gm, "");
			assert.equal(
				/^(export )?(const|let|var)\s+\w+\s*=\s*figma\b/m.test(code),
				false,
				file,
			);
			assert.equal(
				/\bglobalThis\.figma\b/.test(code),
				false,
				`${file}: usa figmaApi()`,
			);
		}
	});

	it("no importan Node ni el servidor: solo sus módulos y tipos del API (se borran al empaquetar)", () => {
		for (const { file, text } of sources()) {
			for (const m of text.matchAll(
				/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gms,
			)) {
				const isType = m[1] !== undefined;
				const from = m[2] ?? "";
				assert.equal(
					from.startsWith("./") ||
						from.startsWith("../") ||
						(isType && from.startsWith("@figma/plugin-typings/")),
					true,
					`${file}: importa ${from}`,
				);
			}
		}
	});
});
