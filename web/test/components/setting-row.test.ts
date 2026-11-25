// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { describe, expect, it, vi } from "vitest";
import type { SettingView } from "#web/lib/contract.ts";
import { view } from "#web/lib/settings/testing/view.ts";
import SettingRow from "#web/lib/ui/organisms/SettingRow.svelte";

const NAME = "Filas por consulta del histórico";

const props = (
	setting: SettingView = view(),
	over: Partial<Record<string, unknown>> = {},
) => ({
	setting,
	problem: null,
	error: null,
	busy: false,
	onsave: () => {},
	onreset: () => {},
	...over,
});

describe("SettingRow", () => {
	it("pinta la ficha: nombre, ayuda, clave, valor, unidad, valor por defecto, origen y cuándo se aplica", () => {
		render(SettingRow, props());
		expect(screen.getByRole("group", { name: NAME })).toBeTruthy();
		const input = screen.getByRole("textbox", { name: NAME });
		expect((input as HTMLInputElement).value).toBe("200");
		expect(screen.getByText(view().help)).toBeTruthy();
		expect(screen.getByText("FCC_HISTORY_MAX_ROWS")).toBeTruthy();
		expect(screen.getByText("filas")).toBeTruthy();
		expect(screen.getByText("Por defecto: 200")).toBeTruthy();
		expect(screen.getByText("Por defecto", { exact: true })).toBeTruthy();
		expect(
			screen.getByText(
				"Se aplica al próximo agente que lances y al reiniciar el panel",
			),
		).toBeTruthy();
	});

	it("una clave que la web no conoce se pinta con la ficha que llega", () => {
		render(
			SettingRow,
			props(
				view({
					key: "FIGMA_EXPORT_MAX_NODES",
					group: "Scripts y lotes",
					name: "Nodos por exportación",
					help: "Cuántos nodos exporta como mucho una lectura.",
					unit: "nodos",
					usedBy: ["agent"],
					effective: 5000,
					default: 5000,
					running: 5000,
				}),
			),
		);
		expect(
			screen.getByRole("textbox", { name: "Nodos por exportación" }),
		).toBeTruthy();
		expect(screen.getByText("FIGMA_EXPORT_MAX_NODES")).toBeTruthy();
		expect(
			screen.getByText("Cuántos nodos exporta como mucho una lectura."),
		).toBeTruthy();
		expect(screen.getByText("nodos")).toBeTruthy();
	});

	it("«Guardar» manda lo escrito", async () => {
		const onsave = vi.fn();
		render(SettingRow, props(view(), { onsave }));
		const input = screen.getByRole("textbox", { name: NAME });
		await fireEvent.input(input, { target: { value: "77" } });
		await fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
		expect(onsave).toHaveBeenCalledWith("77");
	});

	it("«Guardar» está desactivado mientras lo escrito sea igual al valor efectivo", () => {
		render(SettingRow, props());
		const save = screen.getByRole("button", { name: "Guardar" });
		expect(save.hasAttribute("disabled")).toBe(true);
	});

	it("se activa al escribir otro valor, y se desactiva si se vuelve a escribir el de antes", async () => {
		render(SettingRow, props());
		const input = screen.getByRole("textbox", { name: NAME });
		const save = screen.getByRole("button", { name: "Guardar" });
		await fireEvent.input(input, { target: { value: "77" } });
		expect(save.hasAttribute("disabled")).toBe(false);
		await fireEvent.input(input, { target: { value: "200" } });
		expect(save.hasAttribute("disabled")).toBe(true);
	});

	it("desactivado, pulsarlo no guarda", async () => {
		const onsave = vi.fn();
		render(SettingRow, props(view(), { onsave }));
		await fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
		expect(onsave).not.toHaveBeenCalled();
	});

	it("con un valor guardado, «Guardar» compara con el efectivo (lo guardado), no con el de por defecto", async () => {
		render(
			SettingRow,
			props(
				view({ origin: "panel", stored: "77", effective: 77, running: 77 }),
			),
		);
		const input = screen.getByRole("textbox", { name: NAME });
		const save = screen.getByRole("button", { name: "Guardar" });
		expect(save.hasAttribute("disabled")).toBe(true);
		await fireEvent.input(input, { target: { value: "200" } });
		expect(save.hasAttribute("disabled")).toBe(false);
	});

	it("el error del servidor sale debajo del campo y lo marca como inválido", () => {
		const error = "Tiene que ser un número entero mayor que 0.";
		render(SettingRow, props(view(), { error }));
		const input = screen.getByRole("textbox", { name: NAME });
		expect(input.getAttribute("aria-invalid")).toBe("true");
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain(error);
		expect(input.getAttribute("aria-describedby")).toContain(alert.id);
	});

	it("fijado en el entorno: el campo es de solo lectura, sin «Guardar», y dice por qué", () => {
		render(
			SettingRow,
			props(view({ origin: "env", effective: 30, running: 30 })),
		);
		const input = screen.getByRole("textbox", { name: NAME });
		expect((input as HTMLInputElement).readOnly).toBe(true);
		expect((input as HTMLInputElement).value).toBe("30");
		expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
		expect(screen.getByText("Fijado en el entorno")).toBeTruthy();
		expect(
			screen.getByText(
				(_, el) =>
					el?.tagName === "P" &&
					/^Lo fija \.env o el entorno del panel/.test(el.textContent ?? ""),
			).textContent,
		).toContain("quítalo de allí y reinicia");
	});

	it("«Restablecer» solo sale con algo guardado", () => {
		render(SettingRow, props());
		expect(screen.queryByRole("button", { name: "Restablecer" })).toBeNull();
	});

	it("«Restablecer» dice a qué valor vuelve y lo pide", async () => {
		const onreset = vi.fn();
		render(
			SettingRow,
			props(
				view({ origin: "panel", stored: "77", effective: 77, running: 77 }),
				{
					onreset,
				},
			),
		);
		const button = screen.getByRole("button", { name: "Restablecer" });
		const described = document.getElementById(
			button.getAttribute("aria-describedby") ?? "",
		);
		expect(described?.textContent).toBe("Vuelve a 200");
		await fireEvent.click(button);
		expect(onreset).toHaveBeenCalledOnce();
	});

	it("fijado en el entorno con algo guardado: enseña lo guardado que no se aplica y deja restablecerlo (D-6)", () => {
		render(
			SettingRow,
			props(view({ origin: "env", stored: "77", effective: 30, running: 30 })),
		);
		expect(screen.getByText(/«77»/).textContent).toMatch(/no se aplica/);
		expect(screen.getByRole("button", { name: "Restablecer" })).toBeTruthy();
	});

	it("un valor guardado que no vale sale con su motivo", () => {
		const problem = "ajuste ignorado: «FCC_HISTORY_MAX_ROWS»: número inválido";
		render(SettingRow, props(view({ stored: "abc" }), { problem }));
		expect(screen.getByText(/«abc»/).textContent).toContain("número inválido");
		expect(screen.getByRole("button", { name: "Restablecer" })).toBeTruthy();
	});

	it("un ajuste del panel que arrancó con otro valor sale como pendiente de reinicio", () => {
		render(
			SettingRow,
			props(
				view({ origin: "panel", stored: "77", effective: 77, running: 200 }),
			),
		);
		expect(screen.getByText("Pendiente: reinicia el panel")).toBeTruthy();
	});

	it("sin cambio pendiente no dice que haya que reiniciar", () => {
		render(SettingRow, props());
		expect(screen.queryByText("Pendiente: reinicia el panel")).toBeNull();
	});
});
