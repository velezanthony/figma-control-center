// @vitest-environment happy-dom
import { render } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "#web/lib/chat/markdown.ts";
import Markdown from "#web/lib/ui/molecules/Markdown.svelte";
import { must } from "./support.ts";

const list = (source: string, tag: "ul" | "ol"): HTMLElement =>
	must(
		render(Markdown, { blocks: parseMarkdown(source) }).container.querySelector(
			tag,
		),
		`la lista <${tag}>`,
	);

const classesOf = (el: Element): string[] => [...el.classList];

describe("listas de Markdown", () => {
	it("una lista con viñetas sale como ul con disc, y una numerada como ol con decimal y su inicio", () => {
		const bullets = list("- uno\n- dos", "ul");
		expect(bullets.querySelectorAll(":scope > li")).toHaveLength(2);
		expect(classesOf(bullets)).toContain("list-disc");

		const numbered = list("3. tres\n4. cuatro", "ol");
		expect(numbered.getAttribute("start")).toBe("3");
		expect(classesOf(numbered)).toContain("list-decimal");
	});

	it("la lista no es flex ni grid: un li dentro de un contenedor flex pierde su viñeta", () => {
		const classes = classesOf(list("- uno\n- dos", "ul"));
		for (const layout of ["flex", "grid", "inline-flex"])
			expect(classes).not.toContain(layout);
	});

	it("las listas anidadas cambian de marcador (circle y después square)", () => {
		const outer = list("- uno\n  - dos\n    - tres", "ul");
		expect(outer.querySelector("ul ul")).not.toBeNull();
		expect(classesOf(outer)).toContain("[&_ul]:list-[circle]");
		expect(classesOf(outer)).toContain("[&_ul_ul]:list-[square]");
	});
});
