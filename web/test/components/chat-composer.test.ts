// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { beforeAll, describe, expect, it } from "vitest";
import ChatComposer from "#web/lib/ui/molecules/ChatComposer.svelte";
import { stubPopover } from "./support.ts";

beforeAll(stubPopover);

describe("ChatComposer: ejemplos de la ayuda", () => {
	it("pulsar un ejemplo reemplaza el texto, deja el cursor al final con el foco y no envía", async () => {
		let sent = 0;
		render(ChatComposer, {
			value: "texto previo",
			maxLength: 4000,
			onsubmit: () => sent++,
		});
		const field = screen.getByRole("textbox", {
			name: "Mensaje para Claude",
		}) as HTMLTextAreaElement;
		const help = screen.getByRole("button", { name: "¿Qué puedo pedir?" });
		await fireEvent.click(help);
		await fireEvent.click(
			screen.getByRole("button", { name: "¿Qué hace el script scripts/" }),
		);
		await Promise.resolve();
		expect(field.value).toBe("¿Qué hace el script scripts/");
		expect(field.selectionStart).toBe(field.value.length);
		expect(document.activeElement).toBe(field);
		expect(help.getAttribute("aria-expanded")).toBe("false");
		expect(sent).toBe(0);
	});
});
