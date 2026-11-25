// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import "@testing-library/svelte/vitest";
import { describe, expect, it } from "vitest";
import type { DiffHunk } from "#web/lib/contract.ts";
import DiffView from "#web/lib/ui/molecules/DiffView.svelte";

const line = (
	op: "context" | "add" | "del",
	oldNo: number | null,
	newNo: number | null,
	text: string,
) => ({
	op,
	oldNo,
	newNo,
	text,
});

const HUNKS: DiffHunk[] = [
	{
		oldStart: 1,
		oldLines: 3,
		newStart: 1,
		newLines: 3,
		lines: [
			line("context", 1, 1, "a"),
			line("del", 2, null, "b"),
			line("add", null, 2, "B"),
			line("context", 3, 3, "c"),
		],
	},
	{
		oldStart: 40,
		oldLines: 2,
		newStart: 41,
		newLines: 3,
		lines: [
			line("context", 40, 41, "x"),
			line("add", null, 42, "y"),
			line("add", null, 43, "z"),
		],
	},
];

const base = { label: "Cambios de step", hunks: HUNKS };

describe("DiffView", () => {
	it("pinta cada línea con su signo (+, −) además del color y los números de cada lado", () => {
		render(DiffView, base);
		const added = screen.getAllByText("B")[0]?.closest("code");
		expect(added?.getAttribute("data-op")).toBe("add");
		expect(added?.textContent).toContain("+");
		expect(added?.querySelector("[data-new]")?.textContent).toBe("2");
		expect(added?.querySelector("[data-old]")?.textContent).toBe("");
		const removed = screen.getByText("b").closest("code");
		expect(removed?.getAttribute("data-op")).toBe("del");
		expect(removed?.textContent).toContain("−");
		expect(removed?.querySelector("[data-old]")?.textContent).toBe("2");
	});

	it("las líneas van en <pre><code> y la región tiene su nombre", () => {
		render(DiffView, base);
		expect(
			screen.getByRole("region", { name: "Cambios de step" }),
		).toBeTruthy();
		expect(screen.getAllByText("a")[0]?.closest("pre")).toBeTruthy();
	});

	it("cada bloque lleva su título: «cambio 2 de 2, líneas 41 a 43»", () => {
		render(DiffView, base);
		expect(
			screen.getByRole("heading", { name: "cambio 1 de 2, líneas 1 a 3" }),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "cambio 2 de 2, líneas 41 a 43" }),
		).toBeTruthy();
	});

	it("n salta al siguiente bloque, lo enfoca y lo anuncia; p vuelve", async () => {
		render(DiffView, base);
		const region = screen.getByRole("region", { name: "Cambios de step" });
		await fireEvent.keyDown(region, { key: "n" });
		expect(document.activeElement?.getAttribute("aria-labelledby")).toBe(
			screen.getByRole("heading", { name: "cambio 1 de 2, líneas 1 a 3" }).id,
		);
		expect(screen.getByRole("status").textContent).toBe(
			"cambio 1 de 2, líneas 1 a 3",
		);
		await fireEvent.keyDown(region, { key: "n" });
		expect(screen.getByRole("status").textContent).toBe(
			"cambio 2 de 2, líneas 41 a 43",
		);
		await fireEvent.keyDown(region, { key: "p" });
		expect(screen.getByRole("status").textContent).toBe(
			"cambio 1 de 2, líneas 1 a 3",
		);
	});

	it("recortado: dice cuántas líneas se ven y ofrece «Abrir completo» en otra pestaña", () => {
		render(DiffView, {
			...base,
			truncated: true,
			rawHref: "/api/history/attempt-diff/raw?from=1&to=2",
		});
		expect(screen.getByText(/se muestran las primeras 7 líneas/i)).toBeTruthy();
		const link = screen.getByRole("link", { name: /abrir completo/i });
		expect(link.getAttribute("href")).toBe(
			"/api/history/attempt-diff/raw?from=1&to=2",
		);
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toContain("noopener");
	});

	it("sin recorte no hay aviso", () => {
		render(DiffView, base);
		expect(screen.queryByText(/se muestran las primeras/i)).toBeNull();
		expect(screen.queryByRole("link", { name: /abrir completo/i })).toBeNull();
	});

	it("tooLarge: lo dice y no pinta bloques", () => {
		render(DiffView, {
			label: "x",
			hunks: [],
			tooLarge: true,
			rawHref: "/raw",
		});
		expect(
			screen.getByText("Demasiados cambios para compararlos aquí"),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: /abrir completo/i })).toBeTruthy();
		expect(screen.queryByRole("heading")).toBeNull();
	});

	it("tooBig: solo se guardó el hash, con los dos hashes", () => {
		render(DiffView, {
			label: "x",
			hunks: [],
			hashOnly: { from: "a".repeat(64), to: null },
		});
		expect(
			screen.getByText(
				/Solo se guardó el hash \(pasó de FCC_SCRIPT_MAX_BYTES\)/,
			),
		).toBeTruthy();
		expect(screen.getByText("a".repeat(12))).toBeTruthy();
	});

	it("sin cambios de líneas (p. ej. solo cambió el orden de las claves) lo dice", () => {
		render(DiffView, { label: "x", hunks: [] });
		expect(screen.getByText("Sin líneas que mostrar")).toBeTruthy();
	});

	it("modo contenido: una sola columna de números, sin signos ni títulos de cambio", () => {
		render(DiffView, {
			label: "Contenido",
			mode: "content",
			hunks: [
				{
					oldStart: 1,
					oldLines: 2,
					newStart: 1,
					newLines: 2,
					lines: [line("context", 1, 1, "uno"), line("context", 2, 2, "dos")],
				},
			],
		});
		const code = screen.getByText("dos").closest("code");
		expect(code?.querySelectorAll("[data-old]").length).toBe(0);
		expect(code?.querySelector("[data-new]")?.textContent).toBe("2");
		expect(screen.queryByRole("heading")).toBeNull();
	});
});
