// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { createRawSnippet } from "svelte";
import { describe, expect, it } from "vitest";
import Button, {
	BUTTON_VARIANT,
	type ButtonVariant,
} from "#web/lib/ui/atoms/Button.svelte";
import { must } from "./support.ts";

const LABEL = "Guardar";
const children = createRawSnippet(() => ({
	render: () => `<span>${LABEL}</span>`,
}));
const BOXED = Object.values(BUTTON_VARIANT).filter(
	(v): v is Exclude<ButtonVariant, "link"> => v !== BUTTON_VARIANT.link,
);

const classesOf = (el: Element): string[] => [...el.classList];
const hovers = (el: Element): string[] =>
	classesOf(el).filter((c) => c.startsWith("hover:"));
const button = (): HTMLElement => screen.getByRole("button", { name: LABEL });

describe("Button desactivado", () => {
	it.each(BOXED)(
		"%s: lleva disabled y no se limita a bajar la opacidad (relleno hundido, borde y texto atenuados, sin hover)",
		(variant) => {
			render(Button, { variant, disabled: true, children });
			expect(button().hasAttribute("disabled")).toBe(true);
			const classes = classesOf(button());
			for (const role of [
				"bg-surface-sunken",
				"text-text-muted",
				"border-border",
			])
				expect(classes).toContain(role);
			expect(classes.filter((c) => c.includes("opacity"))).toEqual([]);
			expect(hovers(button())).toEqual([]);
		},
	);

	it("el enlace no tiene caja: solo atenúa el texto y pierde el hover", () => {
		render(Button, { variant: BUTTON_VARIANT.link, disabled: true, children });
		expect(classesOf(button())).toContain("text-text-muted");
		expect(classesOf(button())).not.toContain("bg-surface-sunken");
		expect(hovers(button())).toEqual([]);
	});

	it("activo, la variante conserva su aspecto (el estado inerte no se aplica siempre)", () => {
		render(Button, { variant: BUTTON_VARIANT.primary, children });
		expect(button().hasAttribute("disabled")).toBe(false);
		expect(classesOf(button())).not.toContain("bg-surface-sunken");
		expect(classesOf(button())).toContain("bg-ink");
	});

	it("cargando también queda inerte y lo anuncia (aria-busy)", () => {
		render(Button, { loading: true, children });
		expect(button().hasAttribute("disabled")).toBe(true);
		expect(button().getAttribute("aria-busy")).toBe("true");
	});

	it("con href, desactivado: un enlace sin destino y con aria-disabled", () => {
		render(Button, { href: "/#/activity", disabled: true, children });
		const link = must(screen.getByText(LABEL).closest("a"), "el enlace");
		expect(link.hasAttribute("href")).toBe(false);
		expect(link.getAttribute("aria-disabled")).toBe("true");
	});
});
