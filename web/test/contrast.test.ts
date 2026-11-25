import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "../src/app.css"), "utf8");

type Rgb = readonly [number, number, number];

// oklch → sRGB lineal (matrices de Björn Ottosson), recortado al gamut
function oklchToLinear(l: number, c: number, h: number): Rgb {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (x: number) => Math.min(1, Math.max(0, x));
	return [
		clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
		clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
		clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
	];
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: Rgb, b: Rgb) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (hi + 0.05) / (lo + 0.05);
};

const palette = new Map<string, Rgb>();
for (const m of css.matchAll(
	/--color-([a-z]+-\d+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g,
)) {
	palette.set(
		m[1] as string,
		oklchToLinear(Number(m[2]), Number(m[3]), Number(m[4])),
	);
}

const blockOf = (selector: string): string => {
	const start = css.indexOf(selector);
	return css.slice(start, css.indexOf("\n}", start));
};

function rolesOf(selector: string): Map<string, Rgb> {
	const roles = new Map<string, Rgb>();
	for (const m of blockOf(selector).matchAll(
		/--([a-z0-9-]+):\s*var\(--color-([a-z]+-\d+)\)/g,
	)) {
		const color = palette.get(m[2] as string);
		assert.ok(color, `la paleta no tiene ${m[2]}`);
		roles.set(m[1] as string, color);
	}
	return roles;
}

const SELECTORS = {
	oscuro: ':root[data-theme="dark"]',
	claro: ':root[data-theme="light"]',
} as const;
const THEMES = {
	oscuro: rolesOf(SELECTORS.oscuro),
	claro: rolesOf(SELECTORS.claro),
} as const;

// El navegador compone la transparencia en sRGB con gamma: se pasa a gamma, se mezcla y se vuelve a lineal
const toGamma = (x: number) =>
	x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
const toLinear = (x: number) =>
	x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
const over = (top: Rgb, alpha: number, base: Rgb): Rgb =>
	top.map((c, i) =>
		toLinear(alpha * toGamma(c) + (1 - alpha) * toGamma(base[i] as number)),
	) as unknown as Rgb;
// Primera opacidad de una mezcla con `transparent` (el extremo más intenso de un degradado)
const alphaOf = (block: string, token: string): number => {
	const m = new RegExp(`--${token}:[^;]*? (\\d+)%`, "s").exec(block);
	assert.ok(m, `no se encuentra ${token}`);
	return Number(m[1]) / 100;
};

// La barra lateral es oscura en los dos temas: sus tokens y, dentro, los roles de marca del tema oscuro
const SIDEBAR_BLOCK = blockOf(":root {\n\t--sidebar-surface");
const SIDEBAR = rolesOf(":root {\n\t--sidebar-surface");

const TEXT_MIN = 4.5;
const UI_MIN = 3;
const SURFACES = [
	"canvas",
	"surface",
	"surface-raised",
	"surface-sunken",
] as const;
const TINTS = ["brand", "success", "danger", "warning", "info"] as const;

describe("contraste AA de los roles (en la paleta de app.css)", () => {
	it("la paleta y los dos temas se leen del CSS", () => {
		assert.ok(palette.size > 60);
		for (const roles of Object.values(THEMES)) assert.ok(roles.size > 40);
	});

	for (const [theme, roles] of Object.entries(THEMES)) {
		const ratio = (fg: string, bg: string) => {
			const a = roles.get(fg);
			const b = roles.get(bg);
			assert.ok(a && b, `faltan los roles ${fg} o ${bg}`);
			return contrast(a, b);
		};

		it(`tema ${theme}: los tres textos pasan 4,5:1 sobre las superficies`, () => {
			for (const text of ["text-primary", "text-secondary", "text-muted"]) {
				for (const surface of SURFACES) {
					assert.ok(
						ratio(text, surface) >= TEXT_MIN,
						`${text} sobre ${surface}: ${ratio(text, surface).toFixed(2)}`,
					);
				}
			}
		});

		it(`tema ${theme}: el texto sobre relleno de marca y de error pasa 4,5:1`, () => {
			for (const fill of ["brand-500", "brand-600", "danger-600"]) {
				assert.ok(
					ratio("on-brand", fill) >= TEXT_MIN,
					`${fill}: ${ratio("on-brand", fill).toFixed(2)}`,
				);
			}
		});

		it(`tema ${theme}: el texto -700 sobre su tinte -50 pasa 4,5:1 en cada familia`, () => {
			for (const family of TINTS) {
				const r = ratio(`${family}-700`, `${family}-50`);
				assert.ok(r >= TEXT_MIN, `${family}: ${r.toFixed(2)}`);
			}
		});

		it(`tema ${theme}: el texto -700 sobre el pastel -100 de los badges pasa 4,5:1`, () => {
			for (const family of TINTS) {
				const r = ratio(`${family}-700`, `${family}-100`);
				assert.ok(r >= TEXT_MIN, `${family}: ${r.toFixed(2)}`);
			}
		});

		it(`tema ${theme}: foco y borde fuerte pasan 3:1 sobre las superficies`, () => {
			for (const ui of ["focus", "border-strong"]) {
				for (const surface of SURFACES) {
					assert.ok(
						ratio(ui, surface) >= UI_MIN,
						`${ui} sobre ${surface}: ${ratio(ui, surface).toFixed(2)}`,
					);
				}
			}
		});
		it(`tema ${theme}: el texto de la tinta (botón primario) pasa 4,5:1 y la tinta se separa del fondo 3:1`, () => {
			for (const fill of ["ink", "ink-hover"]) {
				assert.ok(
					ratio("on-ink", fill) >= TEXT_MIN,
					`on-ink sobre ${fill}: ${ratio("on-ink", fill).toFixed(2)}`,
				);
			}
			for (const surface of SURFACES) {
				assert.ok(
					ratio("ink", surface) >= UI_MIN,
					`ink sobre ${surface}: ${ratio("ink", surface).toFixed(2)}`,
				);
			}
		});
	}
});

describe("contraste AA de la barra lateral (igual en los dos temas)", () => {
	const get = (role: string): Rgb => {
		const color = SIDEBAR.get(role) ?? THEMES.oscuro.get(role);
		assert.ok(color, `falta ${role}`);
		return color;
	};
	const surface = get("sidebar-surface");
	const white = get("sidebar-text-primary");
	const brand = get("brand-500");
	const BACKGROUNDS = {
		fondo: surface,
		control: get("sidebar-control"),
		hover: over(white, alphaOf(SIDEBAR_BLOCK, "sidebar-hover"), surface),
		"nav hover": over(brand, alphaOf(SIDEBAR_BLOCK, "nav-hover-bg"), surface),
		"nav seleccionado": over(
			brand,
			alphaOf(SIDEBAR_BLOCK, "nav-selected-bg"),
			surface,
		),
	} as const;

	it("los tokens se leen del CSS", () => {
		assert.ok(SIDEBAR.size >= 6);
	});

	for (const [name, bg] of Object.entries(BACKGROUNDS)) {
		it(`los tres textos pasan 4,5:1 sobre ${name}`, () => {
			for (const text of [
				"sidebar-text-primary",
				"sidebar-text-secondary",
				"sidebar-text-muted",
			]) {
				const r = contrast(get(text), bg);
				assert.ok(r >= TEXT_MIN, `${text}: ${r.toFixed(2)}`);
			}
		});

		it(`el icono, el de marca y el punto pasan 3:1 sobre ${name}`, () => {
			for (const ui of ["sidebar-icon", "brand-700", "brand-500", "focus"]) {
				const r = contrast(get(ui), bg);
				assert.ok(r >= UI_MIN, `${ui}: ${r.toFixed(2)}`);
			}
		});
	}
});
