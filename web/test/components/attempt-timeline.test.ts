// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import "@testing-library/svelte/vitest";
import { describe, expect, it, vi } from "vitest";
import type { AttemptRow } from "#web/lib/attempts/present.ts";
import AttemptTimeline from "#web/lib/ui/organisms/AttemptTimeline.svelte";

const row = (n: number, over: Partial<AttemptRow> = {}): AttemptRow => ({
	id: 100 + n,
	n,
	kind: "run_script",
	target: "pasos/a.js",
	status: "ok",
	firstError: null,
	callId: `call-${n}`,
	jobId: null,
	stepIndex: null,
	startedAt: "2026-11-12T08:30:00.000Z",
	finishedAt: "2026-11-12T08:30:01.000Z",
	kit: "figma-kit@1",
	kitSha256: "k",
	assets: [],
	scripts: [],
	changed: n === 1 ? null : ["step"],
	callKept: true,
	change:
		n === 1
			? "intento 1: primero de este objetivo"
			: `intento ${n}: cambió step; kit igual`,
	...over,
});

const NOW = new Date("2026-11-12T10:00:00Z");
const props = (items: AttemptRow[], over: Record<string, unknown> = {}) => ({
	items,
	a: null,
	b: null,
	onpick: () => {},
	now: NOW,
	timeZone: "UTC",
	...over,
});

describe("AttemptTimeline", () => {
	it("un elemento por intento, en orden, con su número, estado en texto, hora y qué cambió", () => {
		render(
			AttemptTimeline,
			props([row(1), row(2, { status: "error" }), row(3)]),
		);
		const items = screen.getAllByRole("listitem");
		expect(items.length).toBe(3);
		expect(items[0]?.textContent).toContain("#1");
		expect(items[1]?.textContent).toContain("Error");
		expect(items[2]?.textContent).toContain("08:30:00");
		expect(items[2]?.textContent).toContain(
			"intento 3: cambió step; kit igual",
		);
	});

	it("el primer intento no dice «qué cambió»: es el primero", () => {
		render(AttemptTimeline, props([row(1)]));
		const text = screen.getByRole("listitem").textContent ?? "";
		expect(text).toContain("primero de este objetivo");
		expect(text).not.toContain("cambió");
	});

	it("el primer error sale recortado, con el mensaje entero en el title", () => {
		const long = "ScriptError: ".padEnd(300, "x");
		render(
			AttemptTimeline,
			props([row(1, { status: "error", firstError: long })]),
		);
		const el = screen.getByTitle(long);
		expect(el.className).toContain("truncate");
	});

	it("«antes» y «después» marcan el par elegido con aria-pressed", () => {
		render(
			AttemptTimeline,
			props([row(1), row(2), row(3)], { a: 102, b: 103 }),
		);
		expect(
			screen
				.getByRole("button", { name: "Usar el intento 2 como antes" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "Usar el intento 3 como después" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "Usar el intento 1 como antes" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("elegir manda el lado y el id del intento", async () => {
		const onpick = vi.fn();
		render(AttemptTimeline, props([row(1), row(2)], { onpick }));
		await fireEvent.click(
			screen.getByRole("button", { name: "Usar el intento 1 como antes" }),
		);
		await fireEvent.click(
			screen.getByRole("button", { name: "Usar el intento 2 como después" }),
		);
		expect(onpick.mock.calls).toEqual([
			["a", 101],
			["b", 102],
		]);
	});

	it("las flechas mueven el foco al mismo botón del intento siguiente o anterior; Inicio y Fin, al primero y al último", async () => {
		render(AttemptTimeline, props([row(1), row(2), row(3)]));
		const after = (n: number) =>
			screen.getByRole("button", { name: `Usar el intento ${n} como después` });
		after(1).focus();
		await fireEvent.keyDown(after(1), { key: "ArrowDown" });
		expect(document.activeElement).toBe(after(2));
		await fireEvent.keyDown(after(2), { key: "End" });
		expect(document.activeElement).toBe(after(3));
		await fireEvent.keyDown(after(3), { key: "ArrowUp" });
		expect(document.activeElement).toBe(after(2));
		await fireEvent.keyDown(after(2), { key: "Home" });
		expect(document.activeElement).toBe(after(1));
	});

	it("enlaza a la llamada en Actividad y, si es un paso de lote, a Jobs", () => {
		render(
			AttemptTimeline,
			props([row(1, { kind: "build_step", jobId: "j1", stepIndex: 0 })]),
		);
		expect(
			screen.getByRole("link", { name: /actividad/i }).getAttribute("href"),
		).toBe("#/activity?open=call-1");
		expect(
			screen.getByRole("link", { name: /jobs/i }).getAttribute("href"),
		).toBe("#/jobs?open=call-1");
	});

	it("si la llamada ya no está en el histórico no hay enlace y se dice", () => {
		render(AttemptTimeline, props([row(1, { callKept: false })]));
		expect(screen.queryByRole("link")).toBeNull();
		expect(
			screen.getByText("La llamada ya no está en el histórico"),
		).toBeTruthy();
	});
});
