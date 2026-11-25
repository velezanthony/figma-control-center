// @vitest-environment happy-dom
import { render } from "@testing-library/svelte";
import "@testing-library/svelte/vitest";
import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import ModalHarness from "./ModalHarness.svelte";
import { must } from "./support.ts";

// Un segundo Escape seguido: Chrome lanza un `cancel` que no se puede cancelar y cierra el <dialog> él solo,
// con el evento `close` unos milisegundos después
const escapeTheBrowserWillNotCancel = (dialog: HTMLDialogElement) =>
	dialog.dispatchEvent(new Event("cancel", { cancelable: false }));

describe("Modal ante el Escape que el navegador no deja cancelar", () => {
	it("si el padre estaba ocupado al pulsarlo, sigue abierto aunque deje de estarlo antes del `close`", async () => {
		let busy = true;
		render(ModalHarness, { isBusy: () => busy });
		const dialog = must(document.querySelector("dialog"), "el <dialog>");
		escapeTheBrowserWillNotCancel(dialog);
		busy = false;
		dialog.close();
		await tick();
		expect(dialog.open).toBe(true);
	});

	it("si el padre no estaba ocupado al pulsarlo, se cierra", async () => {
		render(ModalHarness, { isBusy: () => false });
		const dialog = must(document.querySelector("dialog"), "el <dialog>");
		escapeTheBrowserWillNotCancel(dialog);
		dialog.close();
		await tick();
		expect(dialog.open).toBe(false);
	});
});
