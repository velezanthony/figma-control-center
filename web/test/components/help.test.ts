// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { glossaryHref } from "#web/lib/help/view.ts";
import { routeState } from "#web/lib/route.svelte.ts";
import { parseHash, ROUTE_NAME } from "#web/lib/route.ts";
import Help from "#web/pages/Help.svelte";

// Abre la página como si se llegara por ese hash
function openAt(hash: string): void {
	const parsed = parseHash(hash);
	history.replaceState(null, "", hash);
	routeState.current = parsed.route;
	routeState.search = parsed.search;
}

const selectedTab = () =>
	screen
		.getAllByRole("tab")
		.find((t) => t.getAttribute("aria-selected") === "true")
		?.textContent?.trim();

beforeEach(() => openAt("#/help"));

describe("Ayuda", () => {
	it("abre en «Cómo funciona», con el diagrama y para qué sirve cada sección", () => {
		render(Help);
		expect(selectedTab()).toBe("Cómo funciona");
		expect(screen.getByRole("heading", { name: "Qué es" })).toBeTruthy();
		expect(
			screen.getByRole("list", { name: "Cadena de trabajo" }),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Para qué sirve cada sección" }),
		).toBeTruthy();
		expect(screen.getByText(/Cada llamada de Claude a Figma/)).toBeTruthy();
		expect(
			screen.queryByRole("searchbox", { name: "Buscar en el glosario" }),
		).toBeNull();
	});

	it("cambiar de pestaña la deja en la URL", async () => {
		render(Help);
		await fireEvent.click(screen.getByRole("tab", { name: "Glosario" }));
		expect(location.hash).toBe("#/help?tab=glossary");
		expect(selectedTab()).toBe("Glosario");
		expect(
			screen.getByRole("searchbox", { name: "Buscar en el glosario" }),
		).toBeTruthy();
		await fireEvent.click(screen.getByRole("tab", { name: "Cómo funciona" }));
		expect(location.hash).toBe("#/help");
	});

	it("un enlace al glosario (glossaryHref) abre Glosario con su grupo elegido", () => {
		openAt(glossaryHref("tools"));
		expect(routeState.current).toBe(ROUTE_NAME.help);
		render(Help);
		expect(selectedTab()).toBe("Glosario");
		expect(
			screen
				.getByRole("button", { name: "Herramientas" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
		).toEqual(["Herramientas"]);
	});

	it("elegir un grupo lo deja en la URL", async () => {
		openAt("#/help?tab=glossary");
		render(Help);
		await fireEvent.click(screen.getByRole("button", { name: "Errores" }));
		expect(location.hash).toBe("#/help?tab=glossary&group=errors");
	});
});
