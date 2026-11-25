// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { describe, expect, it } from "vitest";
import type { GroupId } from "#web/lib/glossary/terms.ts";
import { GROUPS, TERMS } from "#web/lib/glossary/terms.ts";
import Glossary from "#web/lib/ui/organisms/Glossary.svelte";
import { must } from "./support.ts";

const shownTerms = () =>
	Array.from(
		document.querySelectorAll("dt > span"),
		(label) => label.textContent,
	);
const groupTitles = () =>
	screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const pill = (name: string) => screen.getByRole("button", { name });
const search = () =>
	screen.getByRole("searchbox", { name: "Buscar en el glosario" });

describe("Glossary: buscar y filtrar por grupo", () => {
	it("sin filtro enseña todos los grupos y todos los términos", () => {
		render(Glossary, { group: null, onselectgroup: () => {} });
		expect(groupTitles()).toEqual(GROUPS.map((g) => g.title));
		expect(shownTerms()).toHaveLength(TERMS.length);
		expect(pill("Todos").getAttribute("aria-pressed")).toBe("true");
	});

	it("la búsqueda deja solo los términos cuyo nombre o explicación coinciden, sin acentos", async () => {
		render(Glossary, { group: null, onselectgroup: () => {} });
		await fireEvent.input(
			screen.getByRole("searchbox", { name: "Buscar en el glosario" }),
			{
				target: { value: "pestana de figma" },
			},
		);
		expect(shownTerms()).toEqual(["Sin pestaña de Figma"]);
		expect(groupTitles()).toEqual(["Errores"]);
	});

	it("una búsqueda sin coincidencias lo dice", async () => {
		render(Glossary, { group: null, onselectgroup: () => {} });
		await fireEvent.input(
			screen.getByRole("searchbox", { name: "Buscar en el glosario" }),
			{
				target: { value: "zzzz" },
			},
		);
		expect(shownTerms()).toEqual([]);
		expect(screen.getByText("Ningún término coincide")).toBeTruthy();
	});

	it("con un grupo elegido solo enseña ese grupo, y su píldora está pulsada", () => {
		render(Glossary, { group: "tools", onselectgroup: () => {} });
		expect(groupTitles()).toEqual(["Herramientas"]);
		const tools = TERMS.filter((t) => t.group === "tools").map((t) => t.label);
		expect(shownTerms()).toEqual(tools);
		expect(pill("Herramientas").getAttribute("aria-pressed")).toBe("true");
		expect(pill("Todos").getAttribute("aria-pressed")).toBe("false");
	});

	it("cada grupo dice cuántos términos enseña, también con la búsqueda", async () => {
		render(Glossary, { group: "errors", onselectgroup: () => {} });
		const errors = TERMS.filter((t) => t.group === "errors").length;
		expect(screen.getByText(`${errors} términos`)).toBeTruthy();
		await fireEvent.input(search(), { target: { value: "ilegible" } });
		expect(screen.getByText("1 término")).toBeTruthy();
	});

	it("cada entrada: término y código a la izquierda; explicación y, solo si la hay, «Qué hacer:» a la derecha", async () => {
		render(Glossary, { group: null, onselectgroup: () => {} });
		await fireEvent.input(search(), { target: { value: "FigmaNotReady" } });
		// Cada entrada es un grupo dt + dd dentro del dl de su grupo
		const entry = must(
			screen.getByText("Figma no está listo").closest("dl > div"),
			"la entrada",
		);
		expect(entry.querySelectorAll("dt")).toHaveLength(1);
		expect(entry.querySelectorAll("dd")).toHaveLength(2);
		expect(screen.getByText("FigmaNotReady").tagName).toBe("CODE");
		expect(entry.textContent).toContain(
			"La pestaña existe, pero el objeto figma aún no está disponible.",
		);
		const hint = screen.getByText("Qué hacer:");
		expect(hint.closest("dd")?.textContent?.trim()).toMatch(/^Qué hacer: \S/);

		await fireEvent.input(search(), { target: { value: "ilegible" } });
		expect(shownTerms()).toEqual(["Script ilegible"]);
		expect(screen.getByText("ScriptReadError").tagName).toBe("CODE");
		expect(screen.queryByText("Qué hacer:")).toBeNull();
	});

	it("pulsar una píldora avisa con su grupo; «Todos» quita el grupo", async () => {
		const picked: (GroupId | null)[] = [];
		render(Glossary, {
			group: "tools",
			onselectgroup: (g: GroupId | null) => picked.push(g),
		});
		await fireEvent.click(pill("Errores"));
		await fireEvent.click(pill("Todos"));
		expect(picked).toEqual(["errors", null]);
	});
});
