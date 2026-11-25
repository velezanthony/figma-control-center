// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { beforeAll, describe, expect, it } from "vitest";
import ChatHelp from "#web/lib/ui/molecules/ChatHelp.svelte";
import { stubPopover } from "./support.ts";

const NAME = "¿Qué puedo pedir?";

beforeAll(stubPopover);

describe("ChatHelp", () => {
	it("el botón existe, cerrado y enlazado a su popover", () => {
		render(ChatHelp);
		const button = screen.getByRole("button", { name: NAME });
		expect(button.getAttribute("aria-expanded")).toBe("false");
		expect(button.getAttribute("aria-controls")).toBeTruthy();
		expect(screen.queryByText(/Pulsa un ejemplo/)).toBeNull();
	});

	it("al pulsarlo muestra los ejemplos de consulta, dice que el agente solo consulta y avisa de que no hay comandos con barra", async () => {
		render(ChatHelp);
		const button = screen.getByRole("button", { name: NAME });
		await fireEvent.click(button);
		expect(button.getAttribute("aria-expanded")).toBe("true");
		const popover = document.getElementById(
			button.getAttribute("aria-controls") ?? "",
		);
		expect(popover?.getAttribute("aria-label")).toBe(NAME);
		expect(
			screen.getByText("Pulsa un ejemplo para escribirlo en la caja:"),
		).toBeTruthy();
		for (const name of [
			"¿Cómo está Figma?",
			"¿Qué se hizo en la última hora?",
			"¿Qué falló hoy?",
			"¿Qué cambió hoy en Figma?",
			"¿Qué hace el script scripts/",
		])
			expect(screen.getByRole("button", { name })).toBeTruthy();
		expect(screen.getByText("scripts/").tagName).toBe("CODE");
		expect(
			screen.getByText(
				"Este agente solo responde preguntas sobre el estado y la actividad del proyecto. Capturar, pintar o construir se hace desde Claude Code en tu proyecto.",
			),
		).toBeTruthy();
		expect(screen.getByText(/no existen aquí/)).toBeTruthy();
		expect(screen.getByText("/mcp").tagName).toBe("CODE");
		expect(screen.getByText("Cerrar agente").tagName).toBe("STRONG");
	});

	it("Escape lo cierra y devuelve el foco al botón", async () => {
		render(ChatHelp);
		const button = screen.getByRole("button", { name: NAME });
		await fireEvent.click(button);
		await fireEvent.keyDown(document.activeElement ?? button, {
			key: "Escape",
		});
		expect(button.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText(/Pulsa un ejemplo/)).toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it("un clic fuera lo cierra", async () => {
		render(ChatHelp);
		const button = screen.getByRole("button", { name: NAME });
		await fireEvent.click(button);
		await fireEvent.click(document.body);
		expect(button.getAttribute("aria-expanded")).toBe("false");
	});

	it("pulsar un ejemplo avisa con su texto exacto y cierra el popover", async () => {
		const picked: string[] = [];
		render(ChatHelp, { onpick: (text: string) => picked.push(text) });
		const button = screen.getByRole("button", { name: NAME });
		await fireEvent.click(button);
		await fireEvent.click(
			screen.getByRole("button", { name: "¿Qué falló hoy?" }),
		);
		await fireEvent.click(button);
		await fireEvent.click(
			screen.getByRole("button", { name: "¿Qué hace el script scripts/" }),
		);
		expect(picked).toEqual(["¿Qué falló hoy?", "¿Qué hace el script scripts/"]);
		expect(button.getAttribute("aria-expanded")).toBe("false");
	});

	it("enlaza las herramientas del agente en Ayuda → Glosario", async () => {
		render(ChatHelp, { onpick: () => {} });
		await fireEvent.click(screen.getByRole("button", { name: NAME }));
		const link = screen.getByRole("link", {
			name: "Ver las herramientas del agente",
		});
		expect(link.getAttribute("href")).toBe("#/help?tab=glossary&group=tools");
	});
});
