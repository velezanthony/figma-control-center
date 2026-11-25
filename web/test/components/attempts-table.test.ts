// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import "@testing-library/svelte/vitest";
import { describe, expect, it, vi } from "vitest";
import type { AttemptTarget } from "#web/lib/contract.ts";
import AttemptsTable from "#web/lib/ui/organisms/AttemptsTable.svelte";

const target = (over: Partial<AttemptTarget> = {}): AttemptTarget => ({
	kind: "capture",
	target: "home",
	attempts: 5,
	lastStatus: "ok",
	lastAt: "2026-11-12T08:30:00.000Z",
	...over,
});

const NOW = new Date("2026-11-12T10:00:00Z");
const props = (rows: AttemptTarget[], over: Record<string, unknown> = {}) => ({
	rows,
	sort: { key: "attempts", dir: "desc" } as const,
	onsort: () => {},
	onopen: () => {},
	onclear: () => {},
	hasAttempts: true,
	now: NOW,
	timeZone: "UTC",
	...over,
});

describe("AttemptsTable", () => {
	it("una fila por objetivo: objetivo, tipo, número de intentos, último estado con texto y hora local", () => {
		render(
			AttemptsTable,
			props([
				target(),
				target({
					kind: "run_script",
					target: "pasos/a.js",
					attempts: 2,
					lastStatus: "error",
				}),
			]),
		);
		const rows = screen.getAllByRole("row").slice(1);
		expect(rows.length).toBe(2);
		expect(rows[0]?.textContent).toContain("home");
		expect(rows[0]?.textContent).toContain("Captura");
		expect(rows[0]?.textContent).toContain("5");
		expect(rows[0]?.textContent).toContain("Correcto");
		expect(rows[0]?.textContent).toContain("08:30:00");
		expect(rows[1]?.textContent).toContain("Error");
		expect(rows[1]?.textContent).toContain("Script");
	});

	it("la cabecera ordenable dice su orden y un clic lo pide al servidor", async () => {
		const onsort = vi.fn();
		render(AttemptsTable, props([target()], { onsort }));
		const attempts = screen.getByRole("columnheader", { name: /intentos/i });
		expect(attempts.getAttribute("aria-sort")).toBe("descending");
		expect(
			screen
				.getByRole("columnheader", { name: /^último$/i })
				.getAttribute("aria-sort"),
		).toBe("none");
		await fireEvent.click(
			within(screen.getByRole("columnheader", { name: /^último$/i })).getByRole(
				"button",
			),
		);
		expect(onsort).toHaveBeenCalledWith("last");
	});

	it("abrir un objetivo: el botón del objetivo (teclado) y un clic en la fila mandan tipo y objetivo", async () => {
		const onopen = vi.fn();
		render(AttemptsTable, props([target()], { onopen }));
		await fireEvent.click(screen.getByRole("button", { name: /home/ }));
		expect(onopen).toHaveBeenLastCalledWith("capture", "home");
		await fireEvent.click(screen.getAllByRole("row")[1] as HTMLElement);
		expect(onopen).toHaveBeenCalledTimes(2);
	});

	it("un objetivo largo se recorta pero conserva su nombre entero en el title", () => {
		const long = `kit/place@1 · ${"x".repeat(200)}`;
		render(AttemptsTable, props([target({ target: long })]));
		expect(screen.getByTitle(long).className).toContain("truncate");
	});

	it("sin ningún intento: lo explica", () => {
		render(AttemptsTable, props([], { hasAttempts: false }));
		expect(screen.getByText("Todavía no hay intentos")).toBeTruthy();
		expect(
			screen.getByText(
				/cada figma_run_script, cada paso de figma_build y cada captura deja uno/i,
			),
		).toBeTruthy();
	});

	it("filtros sin resultado: lo dice y ofrece quitarlos", async () => {
		const onclear = vi.fn();
		render(AttemptsTable, props([], { onclear }));
		expect(
			screen.getByText("Ningún objetivo cumple estos filtros"),
		).toBeTruthy();
		await fireEvent.click(
			screen.getByRole("button", { name: "Quitar filtros" }),
		);
		expect(onclear).toHaveBeenCalled();
	});
});
