// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { createRawSnippet } from "svelte";
import { describe, expect, it } from "vitest";
import CloseAgentButton from "#web/lib/ui/molecules/CloseAgentButton.svelte";

const REASON = "No hay ningún agente en marcha";
const reason = createRawSnippet(() => ({
	render: () => `<span>${REASON}</span>`,
}));

describe("CloseAgentButton desactivado", () => {
	it("el botón lleva disabled y su motivo va en el tooltip que lo describe", () => {
		render(CloseAgentButton, { disabled: true, reason, onclose: () => {} });
		const button = screen.getByRole("button", { name: /Cerrar agente/ });
		expect(button.hasAttribute("disabled")).toBe(true);
		const tooltip = document.getElementById(
			button.getAttribute("aria-describedby") ?? "",
		);
		expect(tooltip?.getAttribute("role")).toBe("tooltip");
		expect(tooltip?.textContent?.trim()).toBe(REASON);
	});

	it("pulsarlo no avisa de cerrar", async () => {
		let closed = 0;
		render(CloseAgentButton, {
			disabled: true,
			reason,
			onclose: () => closed++,
		});
		await fireEvent.click(
			screen.getByRole("button", { name: /Cerrar agente/ }),
		);
		expect(closed).toBe(0);
	});
});
