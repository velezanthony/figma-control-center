import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";

const WEB = join(import.meta.dirname, "..");
const SRC = join(WEB, "src");
const APP_CSS = join(SRC, "app.css");
const UI_DIR = join(SRC, "lib/ui");
const GALLERY = join(SRC, "pages/Gallery.svelte");

const SCANNED = [".svelte", ".ts", ".css", ".html"];

const filesUnder = (dir: string): string[] =>
	readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile() && SCANNED.some((x) => e.name.endsWith(x)))
		.map((e) => join(e.parentPath, e.name));

const PALETTE = "violet|slate|green|red|amber|blue";
const UTILITIES =
	"bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow|accent|caret|placeholder";

// Clases de paleta (bg-violet-500…) y los blancos y negros por defecto de Tailwind
const PALETTE_CLASS = new RegExp(`\\b(?:${UTILITIES})-(?:${PALETTE})-\\d+\\b`);
const DEFAULT_COLOR_CLASS = new RegExp(
	`\\b(?:${UTILITIES})-(?:white|black)\\b`,
);
// Colores sueltos: #rgb, rgb(), hsl(), oklch() y variables de paleta directas
const RAW_COLORS: readonly RegExp[] = [
	/(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/,
	/\brgba?\(/,
	/\bhsla?\(/,
	/\boklch\(/,
	/var\(--color-/,
];

export function violationsIn(path: string, content: string): string[] {
	const found: string[] = [];
	content.split("\n").forEach((line, i) => {
		const where = `${relative(WEB, path)}:${i + 1}`;
		const palette = PALETTE_CLASS.exec(line);
		if (palette) found.push(`${where} clase de paleta «${palette[0]}»`);
		const plain = DEFAULT_COLOR_CLASS.exec(line);
		if (plain) found.push(`${where} color por defecto «${plain[0]}»`);
		for (const raw of RAW_COLORS) {
			const m = raw.exec(line);
			if (m) found.push(`${where} color suelto «${m[0]}»`);
		}
	});
	return found;
}

describe("reglas de color: el detector", () => {
	const at = (line: string) => violationsIn(join(SRC, "x.svelte"), line);

	it("marca clases de paleta, colores por defecto y colores sueltos", () => {
		assert.equal(at('class="bg-violet-500"').length, 1);
		assert.equal(at('class="text-slate-300 hover:border-red-500"').length, 1);
		assert.equal(at('class="text-white"').length, 1);
		assert.equal(at('style="color: #fff"').length, 1);
		assert.equal(at("fill: rgb(0 0 0)").length, 1);
		assert.equal(at("color: oklch(0.5 0.1 20)").length, 1);
		assert.equal(at("color: var(--color-violet-500)").length, 1);
	});

	it("deja pasar los roles, los alias y los anclajes", () => {
		assert.deepEqual(
			at('class="bg-brand-500 text-text-muted border-border"'),
			[],
		);
		assert.deepEqual(at('import X from "#web/lib/ui/X.svelte";'), []);
		assert.deepEqual(at('<a href="#main">'), []);
		assert.deepEqual(at("&#123;"), []);
		assert.deepEqual(at('class="shadow-lg ring-focus"'), []);
	});
});

describe("reglas de color: el código real", () => {
	it("fuera de app.css no hay clases de paleta ni colores sueltos", () => {
		const offenders = filesUnder(SRC)
			.filter((f) => f !== APP_CSS)
			.flatMap((f) => violationsIn(f, readFileSync(f, "utf8")));
		assert.deepEqual(offenders, []);
	});

	it("el index.html tampoco los lleva", () => {
		const path = join(WEB, "index.html");
		assert.deepEqual(violationsIn(path, readFileSync(path, "utf8")), []);
	});
});

describe("galería", () => {
	const LEVELS = ["atoms", "molecules", "organisms"] as const;
	const componentsOf = (level: string) =>
		readdirSync(join(UI_DIR, level))
			.filter((f) => f.endsWith(".svelte"))
			.map((f) => f.replace(".svelte", ""));

	it("muestra todos los componentes de atoms, molecules y organisms", () => {
		const gallery = readFileSync(GALLERY, "utf8");
		const all = LEVELS.flatMap(componentsOf);
		assert.ok(all.length >= 40);
		assert.deepEqual(
			all.filter((c) => !gallery.includes(`<${c}`)),
			[],
		);
	});

	it("enseña todos los iconos del fundamento", () => {
		const gallery = readFileSync(GALLERY, "utf8");
		assert.match(gallery, /Object\.keys\(ICONS\)/);
	});

	it("tiene una sección por nivel", () => {
		const gallery = readFileSync(GALLERY, "utf8");
		for (const title of ["Fundamentos", "Átomos", "Moléculas", "Organismos"]) {
			assert.match(gallery, new RegExp(`>${title}</h2>`));
		}
	});

	it("lib/ui no tiene componentes sueltos fuera de un nivel", () => {
		const loose = readdirSync(UI_DIR).filter((f) => f.endsWith(".svelte"));
		assert.deepEqual(loose, []);
	});
});
