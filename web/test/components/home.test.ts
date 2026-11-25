// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveStore } from "#web/lib/activity/store.svelte.ts";
import type { Agent } from "#web/lib/agent/agent.svelte.ts";
import type { ConnectionStatus } from "#web/lib/contract.ts";
import Home from "#web/pages/Home.svelte";

const READY: ConnectionStatus = {
	at: "2026-01-01T00:00:00.000Z",
	chromeReachable: true,
	tabFound: true,
	figmaReady: true,
	fileName: "Sistema",
	pageName: "Portada",
};
// Solo lo que lee la página: el inicio no abre SSE ni lanza nada en estas pruebas
const store = { tick: 0, connection: "open" } as unknown as LiveStore;
const agent = {
	sessions: [],
	waiting: false,
	launching: false,
	canLaunch: true,
	error: null,
	launch: () => {},
} as unknown as Agent;

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ ok: true, items: [], total: 0 })),
	);
});
afterEach(() => vi.unstubAllGlobals());

const status = () => screen.getByRole("list", { name: "Estado ahora" });

describe("Inicio: el estado del día", () => {
	it("el estado va en píldoras y solo lo que no está bien trae su siguiente paso", () => {
		render(Home, { store, agent, status: READY });
		const pills = status().querySelectorAll("li");
		expect(Array.from(pills, (li) => li.textContent?.trim())).toEqual([
			"Panel conectado",
			"Chrome responde",
			"Figma listo Sistema · Portada",
			"Ningún agente escuchando",
		]);
		expect(
			screen.getByText("Lanza una sesión de Claude Code que atienda el chat."),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Lanzar agente" })).toBeTruthy();
		expect(
			screen.queryByText("Arranca Chrome con el puerto de depuración."),
		).toBeNull();
	});

	it("con todo bien no hay ningún siguiente paso", () => {
		render(Home, {
			store,
			agent: { ...agent, sessions: [{}] } as unknown as Agent,
			status: READY,
		});
		expect(screen.queryByRole("list", { name: "Qué hacer" })).toBeNull();
	});

	it("los accesos a las secciones son tarjetas con nombre, sin párrafo, y en producción sin «Componentes»", () => {
		render(Home, { store, agent, status: READY });
		const access = screen.getByRole("navigation", { name: "Accesos" });
		const link = screen.getByRole("link", { name: "Actividad" });
		expect(access.contains(link)).toBe(true);
		expect(link.getAttribute("href")).toBe("#/activity");
		expect(access.textContent).not.toContain("Componentes");
		expect(screen.queryByText(/Cada llamada de Claude a Figma/)).toBeNull();
	});

	it("ya no lleva «Qué es», la explicación de cada sección ni el glosario: están en Ayuda", () => {
		render(Home, { store, agent, status: READY });
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Inicio",
		);
		expect(screen.getByRole("heading", { name: "Lo último" })).toBeTruthy();
		for (const name of ["Qué es", "Para qué sirve cada sección", "Glosario"]) {
			expect(screen.queryByRole("heading", { name })).toBeNull();
		}
	});
});
