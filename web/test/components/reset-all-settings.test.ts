// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { describe, expect, it, vi } from "vitest";
import ResetAllSettings from "#web/lib/ui/organisms/ResetAllSettings.svelte";

const NAMES = ["Pasos por lote", "Sondeo en vivo del panel"];
const props = (over: Partial<Record<string, unknown>> = {}) => ({
	names: NAMES,
	busy: false,
	onreset: () => {},
	...over,
});

describe("ResetAllSettings", () => {
	it("sin nada guardado: el botón está desactivado y su motivo va en el tooltip", () => {
		render(ResetAllSettings, props({ names: [] }));
		const button = screen.getByRole("button", { name: /Restablecer todo/ });
		expect(button.hasAttribute("disabled")).toBe(true);
		const tooltip = document.getElementById(
			button.getAttribute("aria-describedby") ?? "",
		);
		expect(tooltip?.getAttribute("role")).toBe("tooltip");
		expect(tooltip?.textContent).toMatch(/ningún ajuste guardado/);
	});

	it("con algo guardado está activo y pulsarlo pide confirmar, sin llamar todavía", async () => {
		const onreset = vi.fn();
		render(ResetAllSettings, props({ onreset }));
		const button = screen.getByRole("button", { name: /Restablecer todo/ });
		expect(button.hasAttribute("disabled")).toBe(false);
		await fireEvent.click(button);
		expect(onreset).not.toHaveBeenCalled();
		const dialog = screen.getByRole("dialog");
		expect(dialog.textContent).toContain("2 ajustes");
		for (const name of NAMES) expect(dialog.textContent).toContain(name);
	});

	it("con uno solo lo dice en singular", async () => {
		render(ResetAllSettings, props({ names: ["Pasos por lote"] }));
		await fireEvent.click(
			screen.getByRole("button", { name: /Restablecer todo/ }),
		);
		expect(screen.getByRole("dialog").textContent).toContain("1 ajuste ");
	});

	it("confirmar llama a onreset una vez", async () => {
		const onreset = vi.fn();
		render(ResetAllSettings, props({ onreset }));
		await fireEvent.click(
			screen.getByRole("button", { name: /Restablecer todo/ }),
		);
		const dialog = screen.getByRole("dialog");
		const confirm = [...dialog.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Restablecer todo",
		);
		await fireEvent.click(confirm as HTMLElement);
		expect(onreset).toHaveBeenCalledOnce();
	});

	it("cancelar no llama a onreset", async () => {
		const onreset = vi.fn();
		render(ResetAllSettings, props({ onreset }));
		await fireEvent.click(
			screen.getByRole("button", { name: /Restablecer todo/ }),
		);
		await fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		expect(onreset).not.toHaveBeenCalled();
	});
});
